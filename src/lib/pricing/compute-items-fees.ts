import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSaleFee } from "@/lib/mercadolivre/fees";

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

function getEffectiveWeightKg(
  weightKg: number | null | undefined,
  heightCm: number | null | undefined,
  widthCm: number | null | undefined,
  lengthCm: number | null | undefined
): number | null {
  const real = weightKg != null && weightKg > 0 ? weightKg : null;
  const h = heightCm != null && heightCm > 0 ? heightCm : null;
  const w = widthCm != null && widthCm > 0 ? widthCm : null;
  const l = lengthCm != null && lengthCm > 0 ? lengthCm : null;
  const volumetric = h != null && w != null && l != null ? (h * w * l) / 6000 : null;
  if (real != null && volumetric != null) return Math.max(real, volumetric);
  if (real != null) return real;
  if (volumetric != null) return volumetric;
  return null;
}

/**
 * Peso usado na tabela oficial ML (`ml_shipping_cost_ranges`): faixas `[min, max)` em kg.
 * Cubagem/real podem gerar valores como 2,999999 ou 3,0004; sem snap o primeiro pode cair na faixa
 * "2–3 kg" (ex. R$ 26,25 em ≥200) e o ML na faixa "3–4 kg" (ex. R$ 28,35).
 */
function tariffWeightKgForMlShippingTable(weightKg: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return weightKg;
  const r = Math.round(weightKg * 1000) / 1000;
  const nearest = Math.round(r);
  const SNAP_KG = 0.005;
  if (nearest > 0 && Math.abs(r - nearest) < SNAP_KG) return nearest;
  return r;
}

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

  const getShippingCost = (weightKg: number | null | undefined, price: number): number => {
    if (!ctx.isMercadoLider) return 0;
    if (!weightKg || !shippingRanges?.length) return 0;
    const wTariff = tariffWeightKgForMlShippingTable(Number(weightKg));
    const range = shippingRanges.find(
      (r) =>
        wTariff >= Number(r.weight_min_kg) &&
        (r.weight_max_kg === null || wTariff < Number(r.weight_max_kg))
    );
    if (!range) return 0;
    let cost = 0;
    if (price < 19) cost = Number(range.cost_0_to_18);
    else if (price < 49) cost = Number(range.cost_19_to_48);
    else if (price < 79) cost = Number(range.cost_49_to_78);
    else if (price < 100) cost = Number(range.cost_79_to_99);
    else if (price < 120) cost = Number(range.cost_100_to_119);
    else if (price < 150) cost = Number(range.cost_120_to_149);
    else if (price < 200) cost = Number(range.cost_150_to_199);
    else cost = Number(range.cost_200_plus);
    if (price < 19 && cost > price / 2) cost = price / 2;
    return cost;
  };

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
        const shippingCost = getShippingCost(effectiveWeightKg, price);
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
      const shippingCost = getShippingCost(effectiveWeightKg, price);

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
