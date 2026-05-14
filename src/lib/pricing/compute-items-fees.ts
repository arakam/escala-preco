import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSaleFee } from "@/lib/mercadolivre/fees";
import {
  getEffectiveWeightKg,
  getShippingCostFromRanges,
  type MlShippingCostRangeRow,
} from "@/lib/pricing/ml-shipping-cost-table";

export type PricingFeeInputItem = {
  item_id: string;
  variation_id?: number | null;
  price: number;
  listing_type_id: string;
  category_id: string;
  weight_kg?: number | null;
  height_cm?: number | null;
  width_cm?: number | null;
  length_cm?: number | null;
  /** Subsídio ML na taxa (R$), ex. SMART: original_price × meli_percentage / 100 — abate após listing_prices. */
  meli_fee_subsidy?: number | null;
};

export type PricingFeeResultRow = {
  item_id: string;
  variation_id: number | null;
  price: number;
  fee: number;
  shipping_cost: number;
};

export { getEffectiveWeightKg } from "@/lib/pricing/ml-shipping-cost-table";

/**
 * Taxa de venda ML + frete (tabela Líder), na mesma lógica de POST /api/pricing/calculate.
 */
export async function computeItemsFees(
  items: PricingFeeInputItem[],
  ctx: {
    siteId: string;
    accessToken: string;
    isMercadoLider: boolean;
    supabaseAdmin: SupabaseClient;
  }
): Promise<{
  results: PricingFeeResultRow[];
  errors: { item_id: string; variation_id: number | null; error: string }[];
}> {
  const { data: shippingRanges, error: shippingError } = await ctx.supabaseAdmin
    .from("ml_shipping_cost_ranges")
    .select("*")
    .order("weight_min_kg", { ascending: true });

  if (shippingError) {
    console.error("[computeItemsFees] shipping ranges:", shippingError);
  }

  const ranges = (shippingRanges ?? []) as MlShippingCostRangeRow[];

  const results: PricingFeeResultRow[] = [];
  const errors: { item_id: string; variation_id: number | null; error: string }[] = [];

  for (const item of items) {
    try {
      const price = Math.round(item.price * 100) / 100;
      const weightKg = item.weight_kg != null ? Number(item.weight_kg) : null;
      const heightCm = item.height_cm != null ? Number(item.height_cm) : null;
      const widthCm = item.width_cm != null ? Number(item.width_cm) : null;
      const lengthCm = item.length_cm != null ? Number(item.length_cm) : null;
      const effectiveWeightKg = getEffectiveWeightKg(weightKg, heightCm, widthCm, lengthCm);
      const variationId = item.variation_id ?? null;

      if (price <= 0) {
        results.push({
          item_id: item.item_id,
          variation_id: variationId,
          price: 0,
          fee: 0,
          shipping_cost: 0,
        });
        continue;
      }

      if (!item.category_id) {
        const shippingCost = getShippingCostFromRanges(ranges, ctx.isMercadoLider, effectiveWeightKg, price);
        results.push({
          item_id: item.item_id,
          variation_id: variationId,
          price,
          fee: 0,
          shipping_cost: shippingCost,
        });
        continue;
      }

      const feeResult = await fetchSaleFee(
        ctx.accessToken,
        ctx.siteId,
        item.listing_type_id,
        price,
        item.category_id
      );
      let fee = feeResult?.fee ?? 0;
      const subsidyRaw = item.meli_fee_subsidy;
      if (subsidyRaw != null && Number.isFinite(Number(subsidyRaw)) && Number(subsidyRaw) > 0) {
        const subsidy = Math.round(Number(subsidyRaw) * 100) / 100;
        fee = Math.max(0, Math.round((fee - subsidy) * 100) / 100);
      }
      const shippingCost = getShippingCostFromRanges(ranges, ctx.isMercadoLider, effectiveWeightKg, price);

      results.push({
        item_id: item.item_id,
        variation_id: variationId,
        price,
        fee,
        shipping_cost: shippingCost,
      });
    } catch (e) {
      console.error(`[computeItemsFees] ${item.item_id}:`, e);
      errors.push({
        item_id: item.item_id,
        variation_id: item.variation_id ?? null,
        error: "Erro ao calcular",
      });
      const fallbackPrice = Math.round(Number(item.price) * 100) / 100;
      results.push({
        item_id: item.item_id,
        variation_id: item.variation_id ?? null,
        price: Number.isFinite(fallbackPrice) ? fallbackPrice : 0,
        fee: 0,
        shipping_cost: 0,
      });
    }
  }

  return { results, errors };
}
