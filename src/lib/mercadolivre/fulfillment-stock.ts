/**
 * Estoque Full (depósito ML).
 * @see https://developers.mercadolibre.com.br/pt_br/envios-fulfillment
 * - inventory_id vem de GET /items/{id} (e por variação quando houver)
 * - saldo: GET /inventories/{inventory_id}/stock/fulfillment
 */
import type { MLItemDetail, MLVariationDetail } from "./client";
import { fetchWithRetry } from "./client";
import { parseMlItemTags } from "./item-tags";

export type FulfillmentStockFetchResult =
  | { ok: true; availableQuantity: number; totalQuantity?: number }
  | { ok: false; notFound: true }
  | { ok: false; error: string };

export type FulfillmentItemFields = {
  is_fulfillment: boolean;
  fulfillment_stock: number | null;
  /** Primeiro inventory_id do item ou das variações (referência ML). */
  inventory_id: string | null;
};

/** inventory_id válido para API de estoque Full (não MLB/MLAU). */
export function normalizeMlInventoryId(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // inventory_id de Full não é código de publicação (MLB…) nem User Product (MLAU…)
  if (/^MLB\d/i.test(s) || /^MLAU/i.test(s) || /^ML[A-Z]{2}\d/i.test(s)) return null;
  return s;
}

function readShippingLogisticType(shipping: unknown): string | null {
  if (shipping == null || typeof shipping !== "object") return null;
  const t = (shipping as { logistic_type?: unknown }).logistic_type;
  if (t == null) return null;
  const s = String(t).trim().toLowerCase();
  return s || null;
}

/** Tag fulfillment ou frete logistic_type fulfillment. */
export function itemHasFulfillmentSignals(item: Pick<MLItemDetail, "tags" | "shipping">): boolean {
  if (parseMlItemTags(item.tags).includes("fulfillment")) return true;
  return readShippingLogisticType(item.shipping) === "fulfillment";
}

type InventoryCarrier = { inventory_id?: unknown };

/** IDs de inventário Full do item e variações (documentação ML). */
export function collectFulfillmentInventoryIds(
  item: MLItemDetail,
  variationDetails?: InventoryCarrier[]
): string[] {
  const ids = new Set<string>();
  const main = normalizeMlInventoryId(item.inventory_id);
  if (main) ids.add(main);

  const fromItem = item.variations;
  if (Array.isArray(fromItem)) {
    for (const v of fromItem) {
      const id = normalizeMlInventoryId((v as InventoryCarrier).inventory_id);
      if (id) ids.add(id);
    }
  }

  if (variationDetails) {
    for (const v of variationDetails) {
      const id = normalizeMlInventoryId(v.inventory_id);
      if (id) ids.add(id);
    }
  }

  return Array.from(ids);
}

export function resolvePrimaryInventoryId(
  item: MLItemDetail,
  variationDetails?: InventoryCarrier[]
): string | null {
  const ids = collectFulfillmentInventoryIds(item, variationDetails);
  return ids[0] ?? null;
}

function pickAvailableQuantity(data: Record<string, unknown>): number {
  const raw = data.available_quantity ?? data.available;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export async function getFulfillmentStock(
  inventoryId: string,
  accessToken: string
): Promise<FulfillmentStockFetchResult> {
  const id = inventoryId.trim();
  if (!id) return { ok: false, error: "inventory_id vazio" };
  const url = `https://api.mercadolibre.com/inventories/${encodeURIComponent(id)}/stock/fulfillment`;
  try {
    const res = await fetchWithRetry(url, accessToken);
    if (res.status === 404) return { ok: false, notFound: true };
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `${res.status} ${text.slice(0, 120)}` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const available = pickAvailableQuantity(data);
    const totalRaw = data.total;
    const total =
      totalRaw != null && Number.isFinite(Number(totalRaw)) ? Math.floor(Number(totalRaw)) : undefined;
    return { ok: true, availableQuantity: available, totalQuantity: total };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Consulta estoque Full para todos os inventory_id do anúncio (item + variações).
 */
export async function fetchFulfillmentFieldsForItem(
  item: MLItemDetail,
  accessToken: string,
  variationDetails?: MLVariationDetail[]
): Promise<FulfillmentItemFields> {
  const inventoryIds = collectFulfillmentInventoryIds(item, variationDetails);
  const signals = itemHasFulfillmentSignals(item);
  const primaryInventoryId = inventoryIds[0] ?? null;

  if (inventoryIds.length === 0) {
    return {
      is_fulfillment: signals,
      fulfillment_stock: null,
      inventory_id: null,
    };
  }

  let availableSum = 0;
  let anyStockOk = false;

  for (const invId of inventoryIds) {
    const stock = await getFulfillmentStock(invId, accessToken);
    if (stock.ok) {
      anyStockOk = true;
      availableSum += stock.availableQuantity;
    }
  }

  if (anyStockOk) {
    return {
      is_fulfillment: true,
      fulfillment_stock: availableSum,
      inventory_id: primaryInventoryId,
    };
  }

  // inventory_id no item = publicação ligada ao depósito Full (mesmo sem saldo consultável agora)
  return {
    is_fulfillment: true,
    fulfillment_stock: null,
    inventory_id: primaryInventoryId,
  };
}

/** Linha já persistida — sem nova chamada à API. */
export function fulfillmentFieldsFromStoredRow(row: {
  tags_json?: unknown;
  shipping_json?: unknown;
  inventory_id?: string | null;
  is_fulfillment?: boolean | null;
  fulfillment_stock?: number | null;
}): FulfillmentItemFields {
  const inventory_id = row.inventory_id?.trim() || null;
  if (row.is_fulfillment != null) {
    return {
      is_fulfillment: !!row.is_fulfillment,
      fulfillment_stock:
        row.fulfillment_stock != null && Number.isFinite(Number(row.fulfillment_stock))
          ? Math.floor(Number(row.fulfillment_stock))
          : null,
      inventory_id,
    };
  }
  const signals =
    parseMlItemTags(row.tags_json).includes("fulfillment") ||
    readShippingLogisticType(row.shipping_json) === "fulfillment";
  return {
    is_fulfillment: signals || !!inventory_id,
    fulfillment_stock: null,
    inventory_id,
  };
}
