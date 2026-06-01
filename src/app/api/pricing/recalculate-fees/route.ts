import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { createServiceClient } from "@/lib/supabase/service";
import { computeItemsFees } from "@/lib/pricing/compute-items-fees";
import { PRICING_CALCULATE_CLIENT_BATCH_SIZE } from "@/lib/pricing/calculate-limits";
import { fetchAllPricingCacheRowsForFilters } from "@/lib/pricing/fetch-pricing-cache-rows";
import { parsePricingListingsQueryParams } from "@/lib/pricing/listings-query-params";
import { loadPricingRulesSnapshot } from "@/lib/pricing/pricing-rules-cache";
import { persistCalculatedPricingBatch } from "@/lib/pricing/persist-calculated-batch";

export const maxDuration = 300;

const VARIATION_ID_ITEM = -1;

/**
 * POST /api/pricing/recalculate-fees?{mesmos filtros que /api/pricing/listings}
 * Recalcula taxa e frete para todo o resultado filtrado (não só a página visível).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: { is_mercado_lider?: boolean };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id, site_id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const filters = parsePricingListingsQueryParams(new URL(req.url));
  const serviceSupabase = createServiceClient();
  const { rows, error: fetchError } = await fetchAllPricingCacheRowsForFilters(
    serviceSupabase,
    account.id,
    user.id,
    filters
  );

  if (fetchError) {
    console.error("[pricing/recalculate-fees] fetch cache", fetchError);
    return NextResponse.json({ error: "Erro ao buscar anúncios no cache" }, { status: 500 });
  }

  type CalcItem = {
    item_id: string;
    variation_id: number | null;
    price: number;
    listing_type_id: string;
    category_id: string;
    weight_kg: number | null;
    height_cm: number | null;
    width_cm: number | null;
    length_cm: number | null;
    reference_fee_percent: number | null;
  };

  const itemsToCalculate: CalcItem[] = [];
  let skipped = 0;

  for (const r of rows) {
    const itemId = String(r.item_id ?? "")
      .trim()
      .toUpperCase();
    const variationRaw = r.variation_id as number | null | undefined;
    const variation_id =
      variationRaw == null || variationRaw === VARIATION_ID_ITEM ? null : Number(variationRaw);
    const listing_type_id = r.listing_type_id != null ? String(r.listing_type_id) : "";
    const category_id = r.category_id != null ? String(r.category_id) : "";
    const planned = Number(r.planned_price);
    const current = Number(r.current_price);
    const price = Number.isFinite(planned) && planned > 0 ? planned : current;

    if (!itemId || !Number.isFinite(price) || price <= 0 || !listing_type_id || !category_id) {
      skipped++;
      continue;
    }

    itemsToCalculate.push({
      item_id: itemId,
      variation_id,
      price,
      listing_type_id,
      category_id,
      weight_kg: r.weight_kg != null ? Number(r.weight_kg) : null,
      height_cm: r.height_cm != null ? Number(r.height_cm) : null,
      width_cm: r.width_cm != null ? Number(r.width_cm) : null,
      length_cm: r.length_cm != null ? Number(r.length_cm) : null,
      reference_fee_percent:
        r.reference_fee_percent != null ? Number(r.reference_fee_percent) : null,
    });
  }

  if (itemsToCalculate.length === 0) {
    return NextResponse.json({
      ok: true,
      total_in_cache: rows.length,
      processed: 0,
      skipped,
      errors_count: 0,
    });
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
  const linearFees = itemsToCalculate.every(
    (i) =>
      i.reference_fee_percent != null &&
      Number.isFinite(i.reference_fee_percent) &&
      i.reference_fee_percent >= 0
  );

  const rules = await loadPricingRulesSnapshot(adminSupabase, siteId, {
    loadFeeReferences: linearFees,
  });

  const batchSize = PRICING_CALCULATE_CLIENT_BATCH_SIZE;
  let processed = 0;
  let errors_count = 0;

  for (let i = 0; i < itemsToCalculate.length; i += batchSize) {
    const batch = itemsToCalculate.slice(i, i + batchSize);
    const { results: feeResults, errors } = await computeItemsFees(batch, {
      siteId,
      accessToken,
      isMercadoLider,
      supabaseAdmin: adminSupabase,
      useLinearFees: linearFees,
      rules,
    });

    errors_count += errors.length;

    if (feeResults.length > 0) {
      const persistRows = feeResults.map((r) => ({
        item_id: r.item_id,
        variation_id: r.variation_id,
        price: r.price,
        fee: r.fee,
        shipping_cost: r.shipping_cost,
      }));
      await persistCalculatedPricingBatch(serviceSupabase, account.id, persistRows);
      processed += feeResults.length;
    }
  }

  return NextResponse.json({
    ok: true,
    total_in_cache: rows.length,
    eligible: itemsToCalculate.length,
    processed,
    skipped,
    errors_count,
    linear_fees: linearFees,
    is_mercado_lider: isMercadoLider,
  });
}
