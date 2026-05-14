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

/** Tolerância (p.p.) para aceitar sem mais chamadas ML — chute linear + 1 listing_prices costuma bastar. */
const REFINE_GOOD_ENOUGH_PP = 0.08;
/** Tolerância final na busca binária estreita. */
const REFINE_BISECT_PP = 0.045;
const MAX_BISECT_STEPS = 12;

/**
 * Ajusta o preço com taxa real (listing_prices) + frete tabela.
 * O chute `seedPrice` já vem da fase linear (próximo do correto): intervalo estreito + poucas iterações.
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
  }
): Promise<{ price: number; fee: number; shipping_cost: number } | null> {
  if (!Number.isFinite(seedPrice) || seedPrice <= 0) return null;

  const marginFromRow = (row: { price: number; fee: number; shipping_cost: number }) =>
    achievedNetMarginPercent(
      listing.cost_price,
      row.price,
      row.fee,
      row.shipping_cost,
      listing.tax_percent,
      listing.extra_fee_percent,
      listing.fixed_expenses
    );

  const runOne = async (price: number) => {
    const p = Math.round(price * 100) / 100;
    const item: PricingFeeInputItem = {
      item_id: listing.item_id,
      variation_id: listing.variation_id,
      listing_type_id: listing.listing_type_id,
      category_id: listing.category_id,
      weight_kg: listing.weight_kg,
      height_cm: listing.height_cm,
      width_cm: listing.width_cm,
      length_cm: listing.length_cm,
      price: p,
    };
    const { results } = await computeItemsFees([item], ctx);
    return results[0] ?? null;
  };

  const seed = Math.round(seedPrice * 100) / 100;
  const first = await runOne(seed);
  if (!first) return null;

  let m0 = marginFromRow(first);
  if (Math.abs(m0 - targetPct) <= REFINE_GOOD_ENOUGH_PP) {
    return { price: first.price, fee: first.fee, shipping_cost: first.shipping_cost };
  }

  /** Ampliar janela em torno do seed até [mLo, mHi] englobar o alvo (poucas tentativas, 2 chamadas ML por tentativa). */
  let span = 0.025;
  const maxSpan = 0.42;

  for (let widen = 0; widen < 9 && span <= maxSpan + 1e-9; widen++) {
    const loP = Math.max(0.01, seed * (1 - span));
    const hiP = Math.min(5_000_000, Math.max(seed * (1 + span), loP + 0.02));
    const rLo = await runOne(loP);
    const rHi = await runOne(hiP);
    if (!rLo || !rHi) return { price: first.price, fee: first.fee, shipping_cost: first.shipping_cost };

    const mLo = marginFromRow(rLo);
    const mHi = marginFromRow(rHi);
    const mn = Math.min(mLo, mHi);
    const mx = Math.max(mLo, mHi);

    if (targetPct < mn - 1e-6 || targetPct > mx + 1e-6) {
      span = Math.min(maxSpan, span * 1.65);
      continue;
    }

    const increasing = mLo < mHi;
    let lowP = loP;
    let highP = hiP;
    let best = Math.abs(mLo - targetPct) <= Math.abs(mHi - targetPct) ? rLo : rHi;
    let bestErr = Math.min(Math.abs(mLo - targetPct), Math.abs(mHi - targetPct));

    for (let i = 0; i < MAX_BISECT_STEPS; i++) {
      const mid = (lowP + highP) / 2;
      const rm = await runOne(mid);
      if (!rm) break;
      const mm = marginFromRow(rm);
      const err = Math.abs(mm - targetPct);
      if (err < bestErr) {
        bestErr = err;
        best = rm;
      }
      if (err < REFINE_BISECT_PP) {
        return { price: rm.price, fee: rm.fee, shipping_cost: rm.shipping_cost };
      }

      if (increasing) {
        if (mm < targetPct) lowP = mid;
        else highP = mid;
      } else {
        if (mm < targetPct) highP = mid;
        else lowP = mid;
      }

      if (highP - lowP < 0.015) break;
    }

    return { price: best.price, fee: best.fee, shipping_cost: best.shipping_cost };
  }

  return { price: first.price, fee: first.fee, shipping_cost: first.shipping_cost };
}
