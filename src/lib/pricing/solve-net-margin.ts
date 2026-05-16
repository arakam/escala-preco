import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateFullPricing } from "@/lib/pricing/full-net";
import { computeItemsFees, type PricingFeeInputItem } from "@/lib/pricing/compute-items-fees";
import {
  getEffectiveWeightKg,
  getShippingCostFromRanges,
  type MlShippingCostRangeRow,
} from "@/lib/pricing/ml-shipping-cost-table";

export type SolveMarginListingInput = {
  item_id: string;
  variation_id?: number | null;
  listing_type_id: string;
  category_id: string;
  weight_kg?: number | null;
  height_cm?: number | null;
  width_cm?: number | null;
  length_cm?: number | null;
  cost_price: number;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
};

function achievedNetMarginPercent(
  cost: number,
  price: number,
  fee: number,
  shipping: number,
  taxPercent: number | null,
  extraFeePercent: number | null,
  fixedExpenses: number | null
): number {
  const calc = calculateFullPricing(taxPercent, extraFeePercent, fixedExpenses, {
    price,
    fee,
    shipping_cost: shipping,
  });
  return ((calc.net_amount - cost) / price) * 100;
}

function marginAtLinearFee(
  listing: SolveMarginListingInput,
  price: number,
  feePercentOfPrice: number,
  isMercadoLider: boolean,
  shippingRanges: MlShippingCostRangeRow[]
): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const w = getEffectiveWeightKg(
    listing.weight_kg,
    listing.height_cm,
    listing.width_cm,
    listing.length_cm
  );
  const shipping = getShippingCostFromRanges(shippingRanges, isMercadoLider, w, price);
  const fee = Math.round(((price * feePercentOfPrice) / 100) * 100) / 100;
  return achievedNetMarginPercent(
    listing.cost_price,
    price,
    fee,
    shipping,
    listing.tax_percent,
    listing.extra_fee_percent,
    listing.fixed_expenses
  );
}

/**
 * Busca binária no preço usando taxa de venda ≈ percentual fixo do preço (referência da sync).
 * Sem chamadas ao Mercado Livre.
 */
export function solvePriceWithLinearSaleFeePercent(
  listing: SolveMarginListingInput,
  targetPct: number,
  feePercentOfPrice: number,
  isMercadoLider: boolean,
  shippingRanges: MlShippingCostRangeRow[],
  hints?: { seed_low_scale?: number; current_price?: number; planned_price?: number }
): number | null {
  const C = listing.cost_price;
  if (!Number.isFinite(C) || C <= 0 || !Number.isFinite(feePercentOfPrice) || feePercentOfPrice < 0) return null;

  const planned = hints?.planned_price;
  const current = hints?.current_price;
  let low = Math.max(0.01, C * 0.01);
  let high = Math.max(
    planned != null && planned > 0 ? planned * 2 : 0,
    current != null && current > 0 ? current * 2 : 0,
    C * 3,
    50
  );

  const mAt = (p: number) => marginAtLinearFee(listing, p, feePercentOfPrice, isMercadoLider, shippingRanges);

  let mHigh = mAt(high);
  if (mHigh == null) return null;
  let expand = 0;
  while (mHigh < targetPct && high < 5_000_000 && expand < 28) {
    high = Math.min(high * 1.5, 5_000_000);
    mHigh = mAt(high);
    if (mHigh == null) return null;
    expand++;
  }

  let mLow = mAt(low);
  if (mLow == null) return null;
  expand = 0;
  while (mLow > targetPct && low > 0.01 && expand < 28) {
    low = Math.max(0.01, low * 0.85);
    mLow = mAt(low);
    if (mLow == null) return null;
    expand++;
  }

  let best = (low + high) / 2;
  let bestErr = Infinity;

  for (let i = 0; i < 28; i++) {
    const mid = (low + high) / 2;
    const m = mAt(mid);
    if (m == null) break;
    const err = Math.abs(m - targetPct);
    if (err < bestErr) {
      bestErr = err;
      best = mid;
    }
    if (err < 0.02) {
      best = mid;
      break;
    }
    if (m < targetPct) low = mid;
    else high = mid;
  }

  return Number.isFinite(best) && best > 0 ? best : null;
}

const REFINE_GOOD_ENOUGH_PP = 0.08;
const MAX_STABILIZE_PASSES = 3;

function listingToFeeInput(listing: SolveMarginListingInput, price: number): PricingFeeInputItem {
  return {
    item_id: listing.item_id,
    variation_id: listing.variation_id,
    listing_type_id: listing.listing_type_id,
    category_id: listing.category_id,
    weight_kg: listing.weight_kg,
    height_cm: listing.height_cm,
    width_cm: listing.width_cm,
    length_cm: listing.length_cm,
    price,
  };
}

/**
 * Ajusta preço com taxa real (listing_prices) + frete por faixa.
 * No máximo 3 passadas: ML no preço → re-solve local com % observado → repete se frete/faixa mudou.
 */
export async function refinePriceWithTrueMlFees(
  listing: SolveMarginListingInput,
  targetPct: number,
  seedPrice: number,
  ctx: {
    siteId: string;
    accessToken: string;
    isMercadoLider: boolean;
    supabaseAdmin: SupabaseClient;
  },
  shippingRanges?: MlShippingCostRangeRow[]
): Promise<{ price: number; fee: number; shipping_cost: number } | null> {
  if (!Number.isFinite(seedPrice) || seedPrice <= 0) return null;

  let ranges = shippingRanges;
  if (!ranges) {
    const { data } = await ctx.supabaseAdmin
      .from("ml_shipping_cost_ranges")
      .select("*")
      .order("weight_min_kg", { ascending: true });
    ranges = (data ?? []) as MlShippingCostRangeRow[];
  }

  const wKg = getEffectiveWeightKg(
    listing.weight_kg,
    listing.height_cm,
    listing.width_cm,
    listing.length_cm
  );

  let price = Math.round(seedPrice * 100) / 100;
  let last: { price: number; fee: number; shipping_cost: number } | null = null;

  for (let pass = 0; pass < MAX_STABILIZE_PASSES; pass++) {
    const { results } = await computeItemsFees([listingToFeeInput(listing, price)], ctx);
    const row = results[0];
    if (!row) return last;

    last = { price: row.price, fee: row.fee, shipping_cost: row.shipping_cost };
    const margin = achievedNetMarginPercent(
      listing.cost_price,
      row.price,
      row.fee,
      row.shipping_cost,
      listing.tax_percent,
      listing.extra_fee_percent,
      listing.fixed_expenses
    );
    if (Math.abs(margin - targetPct) <= REFINE_GOOD_ENOUGH_PP) {
      return last;
    }

    if (pass >= MAX_STABILIZE_PASSES - 1) {
      return last;
    }

    const effectiveFeePct = row.price > 0 ? (row.fee / row.price) * 100 : 0;
    const next = solvePriceWithLinearSaleFeePercent(
      listing,
      targetPct,
      effectiveFeePct,
      ctx.isMercadoLider,
      ranges,
      { planned_price: row.price }
    );

    if (next == null || !Number.isFinite(next) || next <= 0) {
      return last;
    }

    const roundedNext = Math.round(next * 100) / 100;
    const nextShipping = getShippingCostFromRanges(ranges, ctx.isMercadoLider, wKg, roundedNext);
    const shippingUnchanged = Math.abs(nextShipping - row.shipping_cost) < 0.01;
    const priceUnchanged = Math.abs(roundedNext - price) < 0.02;

    price = roundedNext;
    if (shippingUnchanged && priceUnchanged) {
      return last;
    }
  }

  return last;
}
