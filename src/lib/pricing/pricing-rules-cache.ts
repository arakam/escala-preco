import type { SupabaseClient } from "@supabase/supabase-js";
import type { MlShippingCostRangeRow } from "@/lib/pricing/ml-shipping-cost-table";

export type PricingRulesSnapshot = {
  shippingRanges: MlShippingCostRangeRow[];
  feePercentByCatType: Map<string, number>;
};

/**
 * Carrega frete (tabela) e % taxa por categoria/tipo uma vez por requisição em lote.
 */
export async function loadPricingRulesSnapshot(
  supabaseAdmin: SupabaseClient,
  siteId: string,
  options?: { loadFeeReferences?: boolean }
): Promise<PricingRulesSnapshot> {
  const [{ data: shippingRanges, error: shippingError }, feeRefResult] = await Promise.all([
    supabaseAdmin
      .from("ml_shipping_cost_ranges")
      .select("*")
      .order("weight_min_kg", { ascending: true }),
    options?.loadFeeReferences !== false
      ? supabaseAdmin
          .from("ml_category_fee_reference")
          .select("category_id, listing_type_id, fee_percent")
          .eq("site_id", siteId)
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (shippingError) {
    console.error("[pricing-rules-cache] shipping ranges:", shippingError);
  }

  const feePercentByCatType = new Map<string, number>();
  if (feeRefResult?.data) {
    for (const fr of feeRefResult.data) {
      const k = `${String(fr.category_id).trim()}:${String(fr.listing_type_id).trim()}`;
      const v = Number(fr.fee_percent);
      if (Number.isFinite(v) && v >= 0) feePercentByCatType.set(k, v);
    }
  }

  return {
    shippingRanges: (shippingRanges ?? []) as MlShippingCostRangeRow[],
    feePercentByCatType,
  };
}
