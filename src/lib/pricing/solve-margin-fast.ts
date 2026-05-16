import { calculateFullPricing, type FullPricingBreakdown } from "@/lib/pricing/full-net";
import {
  getEffectiveWeightKg,
  getShippingCostFromRanges,
  type MlShippingCostRangeRow,
} from "@/lib/pricing/ml-shipping-cost-table";
import {
  solvePriceWithLinearSaleFeePercent,
  type SolveMarginListingInput,
} from "@/lib/pricing/solve-net-margin";

const MAX_FREIGHT_STABILIZE_PASSES = 3;

export type SolveMarginFastInput = SolveMarginListingInput & {
  reference_fee_percent?: number | null;
  current_price?: number | null;
  planned_price?: number | null;
};

export type SolveMarginFastSuccess = {
  item_id: string;
  variation_id: number | null;
  price: number;
  fee: number;
  shipping_cost: number;
  calculated: FullPricingBreakdown;
  reference_fee_percent_used: number;
};

export function resolveReferenceFeePercent(
  item: Pick<SolveMarginFastInput, "reference_fee_percent" | "category_id" | "listing_type_id">,
  feePercentByCatType: Map<string, number>
): number | null {
  const fromItem =
    item.reference_fee_percent != null ? Number(item.reference_fee_percent) : NaN;
  if (Number.isFinite(fromItem) && fromItem >= 0) return fromItem;
  const fromMap = feePercentByCatType.get(`${item.category_id}:${item.listing_type_id}`);
  if (fromMap != null && Number.isFinite(fromMap) && fromMap >= 0) return fromMap;
  return null;
}

/**
 * Resolve margem líquida alvo só em memória: taxa % referência + frete por faixa (sem listing_prices).
 * Até 3 passadas se a faixa de frete mudar após o preço encontrado.
 */
export function solveMarginFast(
  item: SolveMarginFastInput,
  targetPct: number,
  feePercent: number,
  isMercadoLider: boolean,
  shippingRanges: MlShippingCostRangeRow[]
): SolveMarginFastSuccess | null {
  if (!Number.isFinite(targetPct) || !Number.isFinite(feePercent) || feePercent < 0) return null;

  const hints = {
    planned_price:
      item.planned_price != null && Number(item.planned_price) > 0
        ? Number(item.planned_price)
        : undefined,
    current_price:
      item.current_price != null && Number(item.current_price) > 0
        ? Number(item.current_price)
        : undefined,
  };

  let price = solvePriceWithLinearSaleFeePercent(
    item,
    targetPct,
    feePercent,
    isMercadoLider,
    shippingRanges,
    hints
  );
  if (price == null || !Number.isFinite(price) || price <= 0) return null;

  const wKg = getEffectiveWeightKg(item.weight_kg, item.height_cm, item.width_cm, item.length_cm);

  for (let pass = 0; pass < MAX_FREIGHT_STABILIZE_PASSES; pass++) {
    price = Math.round(price * 100) / 100;
    const shipping = getShippingCostFromRanges(shippingRanges, isMercadoLider, wKg, price);
    const next = solvePriceWithLinearSaleFeePercent(item, targetPct, feePercent, isMercadoLider, shippingRanges, {
      planned_price: price,
      current_price: hints.current_price,
    });
    if (next == null || !Number.isFinite(next) || next <= 0) break;

    const roundedNext = Math.round(next * 100) / 100;
    const nextShipping = getShippingCostFromRanges(shippingRanges, isMercadoLider, wKg, roundedNext);
    if (Math.abs(roundedNext - price) < 0.02 && Math.abs(nextShipping - shipping) < 0.01) {
      price = roundedNext;
      break;
    }
    price = roundedNext;
  }

  price = Math.round(price * 100) / 100;
  const shipping_cost = getShippingCostFromRanges(shippingRanges, isMercadoLider, wKg, price);
  const fee = Math.round(((price * feePercent) / 100) * 100) / 100;
  const calculated = calculateFullPricing(item.tax_percent, item.extra_fee_percent, item.fixed_expenses, {
    price,
    fee,
    shipping_cost,
  });

  return {
    item_id: item.item_id,
    variation_id: item.variation_id ?? null,
    price,
    fee,
    shipping_cost,
    calculated,
    reference_fee_percent_used: feePercent,
  };
}
