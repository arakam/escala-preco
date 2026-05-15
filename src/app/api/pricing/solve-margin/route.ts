import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchSaleFee } from "@/lib/mercadolivre/fees";
import { calculateFullPricing } from "@/lib/pricing/full-net";
import {
  getEffectiveWeightKg,
  getShippingCostFromRanges,
  type MlShippingCostRangeRow,
} from "@/lib/pricing/ml-shipping-cost-table";
import { upsertCategoryFeeReferenceFromSample } from "@/lib/pricing/ml-category-fee-reference";
import {
  refinePriceWithTrueMlFees,
  solvePriceWithLinearSaleFeePercent,
  type SolveMarginListingInput,
} from "@/lib/pricing/solve-net-margin";

interface SolveMarginBody {
  item_id: string;
  variation_id?: number | null;
  listing_type_id: string;
  category_id: string;
  weight_kg?: number | null;
  height_cm?: number | null;
  width_cm?: number | null;
  length_cm?: number | null;
  cost_price: number;
  tax_percent?: number | null;
  extra_fee_percent?: number | null;
  fixed_expenses?: number | null;
  target_margin_percent: number;
  is_mercado_lider?: boolean;
  /** Preço atual no ML (coluna Preço) — melhora o intervalo da busca linear */
  current_price?: number | null;
  /** Promoção / preço planejado atual — melhora o intervalo da busca linear */
  planned_price?: number | null;
  /** Se o cache ainda não tem referência, usamos este preço para um listing_prices único e persistimos % */
  seed_price?: number | null;
  /** Opcional: % já conhecido no cliente (coluna reference_fee_percent do cache) */
  reference_fee_percent?: number | null;
  /**
   * Quando true (ex.: margem em massa), não chama refinePriceWithTrueMlFees — usa taxa % referência + frete tabela.
   * Mais rápido; margem/taxa podem divergir um pouco do listing_prices real.
   */
  skip_refine?: boolean;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = (await req.json()) as SolveMarginBody;
  const targetPct = Number(body.target_margin_percent);
  if (!Number.isFinite(targetPct)) {
    return NextResponse.json({ error: "target_margin_percent inválido" }, { status: 400 });
  }

  const cost = Number(body.cost_price);
  if (!Number.isFinite(cost) || cost <= 0) {
    return NextResponse.json({ error: "cost_price obrigatório" }, { status: 400 });
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id, site_id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Configuração do servidor incompleta" }, { status: 500 });
  }

  const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);

  const { data: tokenData, error: tokenError } = await adminSupabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", account.id)
    .single();

  if (tokenError || !tokenData) {
    return NextResponse.json({ error: "Token não encontrado" }, { status: 404 });
  }

  const token = tokenData as { access_token: string; refresh_token: string; expires_at: string };
  const accessToken = await getValidAccessToken(
    account.id,
    token.access_token,
    token.refresh_token,
    token.expires_at,
    adminSupabase
  );

  if (!accessToken) {
    return NextResponse.json({ error: "Falha ao obter token válido" }, { status: 401 });
  }

  const siteId = (account.site_id as string | null)?.trim() || "MLB";
  const isMercadoLider = body.is_mercado_lider ?? false;

  const listing: SolveMarginListingInput = {
    item_id: String(body.item_id).trim().toUpperCase(),
    variation_id: body.variation_id,
    listing_type_id: body.listing_type_id,
    category_id: body.category_id,
    weight_kg: body.weight_kg,
    height_cm: body.height_cm,
    width_cm: body.width_cm,
    length_cm: body.length_cm,
    cost_price: cost,
    tax_percent: body.tax_percent ?? null,
    extra_fee_percent: body.extra_fee_percent ?? null,
    fixed_expenses: body.fixed_expenses ?? null,
  };

  const { data: shippingRanges, error: shipErr } = await adminSupabase
    .from("ml_shipping_cost_ranges")
    .select("*")
    .order("weight_min_kg", { ascending: true });

  if (shipErr) {
    console.error("[solve-margin] shipping ranges:", shipErr);
  }
  const ranges = (shippingRanges ?? []) as MlShippingCostRangeRow[];

  let feePercent = body.reference_fee_percent != null ? Number(body.reference_fee_percent) : NaN;
  if (!Number.isFinite(feePercent) || feePercent < 0) {
    const { data: refRow } = await adminSupabase
      .from("ml_category_fee_reference")
      .select("fee_percent")
      .eq("site_id", siteId)
      .eq("category_id", body.category_id)
      .eq("listing_type_id", body.listing_type_id)
      .maybeSingle();
    if (refRow?.fee_percent != null) {
      feePercent = Number(refRow.fee_percent);
    }
  }

  const seed =
    body.seed_price != null && Number.isFinite(Number(body.seed_price)) && Number(body.seed_price) > 0
      ? Math.round(Number(body.seed_price) * 100) / 100
      : body.planned_price != null && Number(body.planned_price) > 0
        ? Math.round(Number(body.planned_price) * 100) / 100
        : body.current_price != null && Number(body.current_price) > 0
          ? Math.round(Number(body.current_price) * 100) / 100
          : null;

  if (!Number.isFinite(feePercent) || feePercent < 0) {
    if (seed == null) {
      return NextResponse.json(
        {
          error:
            "Sem taxa de referência para esta categoria/tipo. Sincronize os anúncios ou informe seed_price (preço promoção atual).",
        },
        { status: 422 }
      );
    }
    const sampled = await fetchSaleFee(accessToken, siteId, body.listing_type_id, seed, body.category_id);
    if (!sampled || !Number.isFinite(sampled.fee) || seed <= 0) {
      return NextResponse.json(
        { error: "Não foi possível obter taxa ML (listing_prices) para montar a referência." },
        { status: 502 }
      );
    }
    feePercent = (sampled.fee / seed) * 100;
    await upsertCategoryFeeReferenceFromSample({
      supabase: adminSupabase,
      siteId,
      categoryId: body.category_id,
      listingTypeId: body.listing_type_id,
      samplePrice: seed,
      accessToken,
    });
  }

  const linear = solvePriceWithLinearSaleFeePercent(
    listing,
    targetPct,
    feePercent,
    isMercadoLider,
    ranges,
    {
      planned_price: body.planned_price != null ? Number(body.planned_price) : undefined,
      current_price: body.current_price != null ? Number(body.current_price) : undefined,
    }
  );

  if (linear == null) {
    return NextResponse.json({ error: "Não foi possível estimar preço pela margem (modelo linear)." }, { status: 422 });
  }

  const roundedLinear = Math.round(linear * 100) / 100;
  const skipRefine = body.skip_refine === true;

  let finalPrice: number;
  let feeOut: number;
  let shippingOut: number;

  if (skipRefine) {
    const wKg = getEffectiveWeightKg(
      listing.weight_kg,
      listing.height_cm,
      listing.width_cm,
      listing.length_cm
    );
    shippingOut = getShippingCostFromRanges(ranges, isMercadoLider, wKg, roundedLinear);
    feeOut = Math.round(((roundedLinear * feePercent) / 100) * 100) / 100;
    finalPrice = roundedLinear;
  } else {
    const ctx = {
      siteId,
      accessToken,
      isMercadoLider,
      supabaseAdmin: adminSupabase,
    };
    const refined = await refinePriceWithTrueMlFees(listing, targetPct, roundedLinear, ctx);
    if (!refined) {
      return NextResponse.json({ error: "Falha ao refinar preço com listing_prices." }, { status: 502 });
    }
    finalPrice = Math.round(refined.price * 100) / 100;
    feeOut = refined.fee;
    shippingOut = refined.shipping_cost;
  }

  const calculated = calculateFullPricing(
    listing.tax_percent,
    listing.extra_fee_percent,
    listing.fixed_expenses,
    {
      price: finalPrice,
      fee: feeOut,
      shipping_cost: shippingOut,
    }
  );

  /** Alinhar com POST /api/pricing/calculate: sem isso, após mudar margem o planned_price muda mas calculated_* no cache fica do preço antigo e a UI recarrega errada. */
  const serviceSupabase = createServiceClient();
  const now = new Date().toISOString();
  const variationIdForCache = body.variation_id == null || body.variation_id === undefined ? -1 : Number(body.variation_id);
  await serviceSupabase
    .from("pricing_cache")
    .update({
      calculated_price: finalPrice,
      calculated_fee: feeOut,
      calculated_shipping_cost: shippingOut,
      calculated_at: now,
    })
    .eq("account_id", account.id)
    .eq("item_id", listing.item_id)
    .eq("variation_id", variationIdForCache);

  return NextResponse.json({
    price: finalPrice,
    calculated,
    reference_fee_percent_used: feePercent,
    skip_refine: skipRefine,
  });
}
