/**
 * Frete Mercado Líder a partir da tabela `ml_shipping_cost_ranges` (mesma regra que computeItemsFees).
 */

export function getEffectiveWeightKg(
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

export function tariffWeightKgForMlShippingTable(weightKg: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return weightKg;
  const r = Math.round(weightKg * 1000) / 1000;
  const nearest = Math.round(r);
  const SNAP_KG = 0.005;
  if (nearest > 0 && Math.abs(r - nearest) < SNAP_KG) return nearest;
  return r;
}

export type MlShippingCostRangeRow = {
  weight_min_kg: number | string;
  weight_max_kg: number | string | null;
  cost_0_to_18: number | string;
  cost_19_to_48: number | string;
  cost_49_to_78: number | string;
  cost_79_to_99: number | string;
  cost_100_to_119: number | string;
  cost_120_to_149: number | string;
  cost_150_to_199: number | string;
  cost_200_plus: number | string;
};

export function getShippingCostFromRanges(
  shippingRanges: MlShippingCostRangeRow[] | null | undefined,
  isMercadoLider: boolean,
  weightKg: number | null | undefined,
  price: number
): number {
  if (!isMercadoLider) return 0;
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
}
