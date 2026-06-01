import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { createServiceClient } from "@/lib/supabase/service";
import { computeItemsFees } from "@/lib/pricing/compute-items-fees";
import { PRICING_CALCULATE_CLIENT_BATCH_SIZE } from "@/lib/pricing/calculate-limits";
import { loadPricingRulesSnapshot } from "@/lib/pricing/pricing-rules-cache";
import { persistCalculatedPricingBatch } from "@/lib/pricing/persist-calculated-batch";

interface CalculateRequest {
  items: {
    item_id: string;
    variation_id?: number | null;
    price: number;
    listing_type_id: string;
    category_id: string;
    weight_kg?: number | null;
    height_cm?: number | null;
    width_cm?: number | null;
    length_cm?: number | null;
    /** Subsídio ML na taxa (R$), ex. SMART: original_price × meli_percentage / 100 */
    meli_fee_subsidy?: number | null;
    /** % taxa ML (fee/preço) do cache; usado com linear_fees */
    reference_fee_percent?: number | null;
  }[];
  is_mercado_lider?: boolean;
  /** default true; false = só simula (ex.: tela Promoções) sem gravar calculated_* no pricing_cache */
  persist?: boolean;
  /**
   * Taxa linear (% referência × preço) + frete em tabela, sem listing_prices por item (ex.: desconto em massa).
   */
  linear_fees?: boolean;
}

interface CalculatedItem {
  item_id: string;
  variation_id: number | null;
  price: number;
  fee: number;
  shipping_cost: number;
  net_amount: number;
}

/** Evita 504 em lotes grandes enviados pela tela (várias páginas ou seleção ampla). */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = (await req.json()) as CalculateRequest;

  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    console.warn("[pricing/calculate] 400: lista de items vazia ou inválida");
    return NextResponse.json({ error: "Nenhum item para calcular" }, { status: 400 });
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

  const siteId = account.site_id || "MLB";
  const isMercadoLider = body.is_mercado_lider ?? false;
  const persist = body.persist !== false;
  const linearFees = body.linear_fees === true;

  const rules = await loadPricingRulesSnapshot(adminSupabase, siteId, {
    loadFeeReferences: linearFees,
  });

  const batchSize = PRICING_CALCULATE_CLIENT_BATCH_SIZE;
  const feeResults: Awaited<ReturnType<typeof computeItemsFees>>["results"] = [];
  const errors: Awaited<ReturnType<typeof computeItemsFees>>["errors"] = [];

  for (let i = 0; i < body.items.length; i += batchSize) {
    const chunk = body.items.slice(i, i + batchSize);
    const batch = await computeItemsFees(chunk, {
      siteId,
      accessToken,
      isMercadoLider,
      supabaseAdmin: adminSupabase,
      useLinearFees: linearFees,
      rules,
    });
    feeResults.push(...batch.results);
    errors.push(...batch.errors);
  }

  const results: CalculatedItem[] = feeResults.map((r) => {
    const netAmount = Math.round((r.price - r.fee - r.shipping_cost) * 100) / 100;
    return {
      item_id: r.item_id,
      variation_id: r.variation_id,
      price: r.price,
      fee: r.fee,
      shipping_cost: r.shipping_cost,
      net_amount: netAmount,
    };
  });

  if (persist) {
    const serviceSupabase = createServiceClient();
    await persistCalculatedPricingBatch(serviceSupabase, account.id, results);
  }

  return NextResponse.json({
    results,
    errors,
    is_mercado_lider: isMercadoLider,
  });
}
