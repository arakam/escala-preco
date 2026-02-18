/**
 * Aplicação de preços de atacado no Mercado Livre.
 * Endpoint oficial: POST /items/{item_id}/prices/standard/quantity
 * https://developers.mercadolivre.com.br/pt_br/precos-por-quantidade
 */

import type { Tier } from "@/lib/atacado";
import { getItemPrices, postItemPricesQuantity } from "./client";

/** Draft validado para envio (item ou variação). */
export interface ValidWholesaleDraft {
  item_id: string;
  variation_id: number | null;
  tiers: Tier[];
}

/**
 * Valida um draft antes de enviar ao ML.
 * - tiers ordenados por min_qty, min_qty >= 2, price > 0
 * - Se item tem variações → variation_id obrigatório
 * - Se não tem variações → variation_id null
 */
export function validateDraftForApply(
  draft: { item_id: string; variation_id: number | null; tiers: unknown[] },
  hasVariations: boolean
): { valid: true; draft: ValidWholesaleDraft } | { valid: false; reason: string } {
  const tiersRaw = Array.isArray(draft.tiers) ? draft.tiers : [];
  const tiers: Tier[] = [];
  for (const t of tiersRaw) {
    if (t && typeof t === "object" && "min_qty" in t && "price" in t) {
      const minQty = Number((t as { min_qty: number }).min_qty);
      const price = Number((t as { price: number }).price);
      if (Number.isInteger(minQty) && minQty >= 2 && price > 0) {
        tiers.push({ min_qty: minQty, price });
      }
    }
  }
  if (tiers.length === 0) {
    return { valid: false, reason: "Nenhum tier válido (min_qty >= 2, price > 0)" };
  }
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  const seen = new Set<number>();
  for (const t of sorted) {
    if (seen.has(t.min_qty)) {
      return { valid: false, reason: "Quantidade mínima duplicada" };
    }
    seen.add(t.min_qty);
  }
  if (hasVariations && draft.variation_id == null) {
    return { valid: false, reason: "Item com variações exige variation_id" };
  }
  if (!hasVariations && draft.variation_id != null) {
    return { valid: false, reason: "Item sem variações deve ter variation_id null" };
  }
  return {
    valid: true,
    draft: { item_id: draft.item_id, variation_id: draft.variation_id ?? null, tiers: sorted },
  };
}

/**
 * Monta o payload para POST /items/{item_id}/prices/standard/quantity.
 * amount em reais. ML exige amount ÚNICO em cada preço por quantidade (invalid.price_per_quantity).
 * Se dois tiers tiverem o mesmo preço, mantemos o de menor min_qty.
 */
function buildWholesalePayload(
  tiers: Tier[],
  standardPriceId: string | null,
  currencyId = "BRL"
): { prices: Array<Record<string, unknown>> } {
  const seenAmounts = new Set<number>();
  const quantityPrices: Array<Record<string, unknown>> = [];
  for (const t of tiers.slice(0, 5)) {
    const amount = Number(t.price);
    if (seenAmounts.has(amount)) continue;
    seenAmounts.add(amount);
    quantityPrices.push({
      amount,
      currency_id: currencyId,
      conditions: {
        context_restrictions: ["channel_marketplace", "user_type_business"],
        min_purchase_unit: t.min_qty,
      },
    });
  }
  const prices: Array<Record<string, unknown>> = [];
  if (standardPriceId) {
    prices.push({ id: standardPriceId });
  }
  prices.push(...quantityPrices);
  return { prices };
}

export type UpdateWholesaleResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      message: string;
      responseBody?: string;
      responseJson?: unknown;
    };

/**
 * Atualiza preços por quantidade (atacado) no Mercado Livre.
 * Busca o preço padrão atual para incluí-lo no payload (manter preço unitário) e envia todos os tiers.
 */
export async function updateWholesalePrices(
  itemId: string,
  _variationId: number | null,
  tiers: Tier[],
  accessToken: string,
  _hasVariations: boolean
): Promise<UpdateWholesaleResult> {
  const currentPrices = await getItemPrices(itemId, accessToken, { showAllPrices: true });
  const standardId =
    currentPrices?.prices?.find((p) => !p.conditions?.min_purchase_unit)?.id ?? null;
  const payload = buildWholesalePayload(tiers, standardId, "BRL");
  const result = await postItemPricesQuantity(itemId, accessToken, payload);
  if (result.ok) return { ok: true };
  return {
    ok: false,
    status: result.status,
    message: result.body?.slice(0, 500) ?? `HTTP ${result.status}`,
    responseBody: result.body,
    responseJson: result.json,
  };
}
