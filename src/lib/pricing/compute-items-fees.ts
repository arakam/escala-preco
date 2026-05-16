import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSaleFeesParallel } from "@/lib/mercadolivre/fees";
import { loadPricingRulesSnapshot, type PricingRulesSnapshot } from "@/lib/pricing/pricing-rules-cache";
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
  /** % taxa ML (fee/preço) do cache; usado com useLinearFees em vez de listing_prices */
  reference_fee_percent?: number | null;
};

export type PricingFeeResultRow = {
  item_id: string;
  variation_id: number | null;
  price: number;
  fee: number;
  shipping_cost: number;
};

export { getEffectiveWeightKg } from "@/lib/pricing/ml-shipping-cost-table";

function applyMeliSubsidy(feeBase: number, subsidyRaw: number | null | undefined): number {
  let fee = feeBase;
  if (subsidyRaw != null && Number.isFinite(Number(subsidyRaw)) && Number(subsidyRaw) > 0) {
    const subsidy = Math.round(Number(subsidyRaw) * 100) / 100;
    fee = Math.max(0, Math.round((fee - subsidy) * 100) / 100);
  }
  return fee;
}

function resolveReferenceFeePercent(
  item: PricingFeeInputItem,
  refByCatType: Map<string, number>
): number | null {
  const fromItem = item.reference_fee_percent != null ? Number(item.reference_fee_percent) : NaN;
  if (Number.isFinite(fromItem) && fromItem >= 0) return fromItem;
  const fromMap = refByCatType.get(`${item.category_id}:${item.listing_type_id}`);
  if (fromMap != null && Number.isFinite(fromMap) && fromMap >= 0) return fromMap;
  return null;
}

function computeLinearFeeRow(
  item: PricingFeeInputItem,
  price: number,
  variationId: number | null,
  effectiveWeightKg: number | null,
  ranges: MlShippingCostRangeRow[],
  isMercadoLider: boolean,
  refByCatType: Map<string, number>
): { row: PricingFeeResultRow | null; error?: string } {
  const feePct = resolveReferenceFeePercent(item, refByCatType);
  if (feePct == null) {
    return {
      row: null,
      error: "Sem taxa de referência para categoria/tipo; sincronize os anúncios.",
    };
  }
  const feeBase = Math.round(((price * feePct) / 100) * 100) / 100;
  const fee = applyMeliSubsidy(feeBase, item.meli_fee_subsidy);
  const shippingCost = getShippingCostFromRanges(ranges, isMercadoLider, effectiveWeightKg, price);
  return {
    row: {
      item_id: item.item_id,
      variation_id: variationId,
      price,
      fee,
      shipping_cost: shippingCost,
    },
  };
}

type MlFeeWorkItem = {
  item: PricingFeeInputItem;
  price: number;
  variationId: number | null;
  effectiveWeightKg: number | null;
};

/**
 * Taxa de venda ML + frete (tabela Líder), na mesma lógica de POST /api/pricing/calculate.
 * Regras carregadas uma vez; listing_prices em paralelo quando não linear.
 */
export async function computeItemsFees(
  items: PricingFeeInputItem[],
  ctx: {
    siteId: string;
    accessToken: string;
    isMercadoLider: boolean;
    supabaseAdmin: SupabaseClient;
    /**
     * Taxa = preço × % referência + frete em tabela; sem chamadas listing_prices (ex.: desconto em massa).
     */
    useLinearFees?: boolean;
    /** Snapshot pré-carregado (evita SELECT duplicado na mesma requisição). */
    rules?: PricingRulesSnapshot;
  }
): Promise<{
  results: PricingFeeResultRow[];
  errors: { item_id: string; variation_id: number | null; error: string }[];
}> {
  const rules =
    ctx.rules ??
    (await loadPricingRulesSnapshot(ctx.supabaseAdmin, ctx.siteId, {
      loadFeeReferences: ctx.useLinearFees !== false,
    }));

  const { shippingRanges: ranges, feePercentByCatType: refByCatType } = rules;

  const results: PricingFeeResultRow[] = [];
  const errors: { item_id: string; variation_id: number | null; error: string }[] = [];
  const mlWork: MlFeeWorkItem[] = [];

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

      if (ctx.useLinearFees) {
        const { row, error } = computeLinearFeeRow(
          item,
          price,
          variationId,
          effectiveWeightKg,
          ranges,
          ctx.isMercadoLider,
          refByCatType
        );
        if (error) {
          errors.push({ item_id: item.item_id, variation_id: variationId, error });
        }
        if (row) results.push(row);
        continue;
      }

      mlWork.push({ item, price, variationId, effectiveWeightKg });
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

  if (mlWork.length > 0) {
    const feeResponses = await fetchSaleFeesParallel(
      ctx.accessToken,
      ctx.siteId,
      mlWork.map((w) => ({
        listing_type_id: w.item.listing_type_id,
        price: w.price,
        category_id: w.item.category_id,
      }))
    );

    for (let i = 0; i < mlWork.length; i++) {
      const w = mlWork[i];
      try {
        const feeResult = feeResponses[i];
        let fee = feeResult?.fee ?? 0;
        fee = applyMeliSubsidy(fee, w.item.meli_fee_subsidy);
        const shippingCost = getShippingCostFromRanges(
          ranges,
          ctx.isMercadoLider,
          w.effectiveWeightKg,
          w.price
        );
        results.push({
          item_id: w.item.item_id,
          variation_id: w.variationId,
          price: w.price,
          fee,
          shipping_cost: shippingCost,
        });
      } catch (e) {
        console.error(`[computeItemsFees] ML ${w.item.item_id}:`, e);
        errors.push({
          item_id: w.item.item_id,
          variation_id: w.variationId,
          error: "Erro ao calcular",
        });
        results.push({
          item_id: w.item.item_id,
          variation_id: w.variationId,
          price: w.price,
          fee: 0,
          shipping_cost: 0,
        });
      }
    }
  }

  return { results, errors };
}
