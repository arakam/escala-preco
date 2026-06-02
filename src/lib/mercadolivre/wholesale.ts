/**
 * Aplicação de preços de atacado no Mercado Livre.
 * Endpoint oficial: POST /items/{item_id}/prices/standard/quantity
 * https://developers.mercadolivre.com.br/pt_br/precos-por-quantidade
 */

import type { Tier } from "@/lib/atacado";
import {
  getItemPrices,
  getStandardPriceAmount,
  postItemPricesQuantity,
  type MLItemPricesResponse,
} from "./client";

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

/** Preço por quantidade (atacado B2B) no GET /items/{id}/prices. */
function isWholesaleQuantityPrice(
  p: MLItemPricesResponse["prices"][number]
): boolean {
  const minUnit = p.conditions?.min_purchase_unit;
  return minUnit != null && Number.isFinite(Number(minUnit));
}

/**
 * Regras do ML para a tabela de atacado: preço unitário decrescente por faixa e abaixo do standard.
 * https://developers.mercadolivre.com.br/pt_br/precos-por-quantidade
 */
export function validateTiersCoherenceForMl(
  tiers: Tier[],
  standardAmount: number | null
): string | null {
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].price >= sorted[i - 1].price) {
      return (
        `Faixa qtd ${sorted[i].min_qty} (R$ ${sorted[i].price}) deve ter preço menor que a faixa anterior ` +
        `(qtd ${sorted[i - 1].min_qty}, R$ ${sorted[i - 1].price}).`
      );
    }
  }
  if (standardAmount != null && Number.isFinite(standardAmount)) {
    for (const t of sorted) {
      if (t.price >= standardAmount) {
        return (
          `Faixa qtd ${t.min_qty} (R$ ${t.price}) deve ser menor que o preço padrão do anúncio no ML (R$ ${standardAmount}).`
        );
      }
    }
  }
  return null;
}

/**
 * Monta o payload para POST /items/{item_id}/prices/standard/quantity.
 * - Mantém todos os preços que NÃO são atacado (só `{ id }`), conforme doc do ML.
 * - Omite IDs das faixas de atacado atuais → ML remove a tabela antiga antes de aplicar as novas.
 * - amount em reais; valores duplicados entre faixas são ignorados (ML exige amounts únicos).
 */
function buildWholesalePayload(
  tiers: Tier[],
  currentPrices: MLItemPricesResponse | null,
  currencyId = "BRL"
): { prices: Array<Record<string, unknown>> } {
  const keepPriceStubs: Array<Record<string, unknown>> = [];
  const seenKeepIds = new Set<string>();
  for (const p of currentPrices?.prices ?? []) {
    if (!p.id || seenKeepIds.has(p.id)) continue;
    if (isWholesaleQuantityPrice(p)) continue;
    seenKeepIds.add(p.id);
    keepPriceStubs.push({ id: p.id });
  }

  const seenAmounts = new Set<number>();
  const quantityPrices: Array<Record<string, unknown>> = [];
  const sortedTiers = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  for (const t of sortedTiers.slice(0, 5)) {
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

  return { prices: [...keepPriceStubs, ...quantityPrices] };
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
  const standardAmount = getStandardPriceAmount(currentPrices);
  const coherenceError = validateTiersCoherenceForMl(tiers, standardAmount);
  if (coherenceError) {
    return {
      ok: false,
      status: 400,
      message: coherenceError,
      responseJson: { error: "invalid.price_per_quantity", message: coherenceError },
    };
  }
  const payload = buildWholesalePayload(tiers, currentPrices, "BRL");
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
