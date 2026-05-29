/**
 * Estoque Full (depósito ML).
 * @see https://developers.mercadolibre.com.br/pt_br/envios-fulfillment
 * @see https://developers.mercadolibre.com.br/pt_br/estoque-distribuido
 *
 * - Modelo clássico: GET /inventories/{inventory_id}/stock/fulfillment (campo total)
 * - User Product (MLBU): GET /user-products/{user_product_id}/stock (location meli_facility)
 */
import type { MLItemDetail, MLVariationDetail } from "./client";
import { fetchWithRetry } from "./client";
import { parseMlItemTags } from "./item-tags";

export type FulfillmentStockFetchResult =
  | { ok: true; availableQuantity: number; totalQuantity?: number }
  | { ok: false; notFound: true }
  | { ok: false; error: string };

export type UserProductStockFetchResult =
  | {
      ok: true;
      meliFacilityQuantity: number;
      sellingAddressQuantity: number;
      sellerWarehouseQuantity: number;
      totalQuantity: number;
    }
  | { ok: false; notFound: true }
  | { ok: false; error: string };

export type FulfillmentStockByInventory = {
  inventory_id: string;
  depot_quantity: number;
  available_quantity: number;
};

export type FulfillmentItemFields = {
  is_fulfillment: boolean;
  fulfillment_stock: number | null;
  /** Primeiro inventory_id do item ou das variações (referência ML). */
  inventory_id: string | null;
};

export type FulfillmentStockFieldsResult = FulfillmentItemFields & {
  byInventory: FulfillmentStockByInventory[];
  /** Full + próprio (user-products); null = usar available_quantity do GET /items. */
  total_listing_stock: number | null;
  /** Estoque próprio / Flex (selling_address + seller_warehouse). */
  seller_stock: number | null;
};

export type StoredFulfillmentRow = {
  fulfillment_stock?: number | null;
  fulfillment_synced_at?: string | null;
  inventory_id?: string | null;
  user_product_id?: string | null;
};

const DEFAULT_FULFILLMENT_TTL_MS = 30 * 60 * 1000;

/** TTL do estoque Full (ms). Padrão 30 min. Defina ML_FULFILLMENT_STOCK_TTL_MS no .env. */
export function getFulfillmentStockTtlMs(): number {
  const raw = process.env.ML_FULFILLMENT_STOCK_TTL_MS;
  if (raw === undefined || raw === "") return DEFAULT_FULFILLMENT_TTL_MS;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return DEFAULT_FULFILLMENT_TTL_MS;
}

/** inventory_id válido para API de estoque Full (não MLB/MLAU). */
export function normalizeMlInventoryId(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // inventory_id de Full não é código de publicação (MLB…) nem User Product (MLAU…)
  if (/^MLB\d/i.test(s) || /^MLAU/i.test(s) || /^ML[A-Z]{2}\d/i.test(s)) return null;
  return s;
}

export function normalizeUserProductId(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
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

/** Total físico no depósito Full (available + indisponíveis). */
function pickDepotTotalQuantity(data: Record<string, unknown>): number {
  const totalRaw = data.total;
  if (totalRaw != null && Number.isFinite(Number(totalRaw)) && Number(totalRaw) >= 0) {
    return Math.floor(Number(totalRaw));
  }
  return pickAvailableQuantity(data);
}

function pickFulfillmentDepotAvailable(stock: Extract<FulfillmentStockFetchResult, { ok: true }>): number {
  return stock.availableQuantity;
}

function parseUserProductStockLocations(data: Record<string, unknown>): {
  meliFacility: number;
  sellingAddress: number;
  sellerWarehouse: number;
  total: number;
} {
  const locations = data.locations;
  let meliFacility = 0;
  let sellingAddress = 0;
  let sellerWarehouse = 0;
  if (Array.isArray(locations)) {
    for (const loc of locations) {
      if (loc == null || typeof loc !== "object") continue;
      const type = String((loc as { type?: unknown }).type ?? "")
        .trim()
        .toLowerCase();
      const qty = Number((loc as { quantity?: unknown }).quantity);
      if (!Number.isFinite(qty) || qty < 0) continue;
      const n = Math.floor(qty);
      if (type === "meli_facility") meliFacility += n;
      else if (type === "selling_address") sellingAddress += n;
      else if (type === "seller_warehouse") sellerWarehouse += n;
    }
  }
  return {
    meliFacility,
    sellingAddress,
    sellerWarehouse,
    total: meliFacility + sellingAddress + sellerWarehouse,
  };
}

function sumMeliFacilityQuantity(data: Record<string, unknown>): number {
  return parseUserProductStockLocations(data).meliFacility;
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
    const total = pickDepotTotalQuantity(data);
    return { ok: true, availableQuantity: available, totalQuantity: total };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getUserProductMeliFacilityStock(
  userProductId: string,
  accessToken: string
): Promise<UserProductStockFetchResult> {
  const id = userProductId.trim();
  if (!id) return { ok: false, error: "user_product_id vazio" };
  const url = `https://api.mercadolibre.com/user-products/${encodeURIComponent(id)}/stock`;
  try {
    const res = await fetchWithRetry(url, accessToken);
    if (res.status === 404) return { ok: false, notFound: true };
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `${res.status} ${text.slice(0, 120)}` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const breakdown = parseUserProductStockLocations(data);
    return {
      ok: true,
      meliFacilityQuantity: breakdown.meliFacility,
      sellingAddressQuantity: breakdown.sellingAddress,
      sellerWarehouseQuantity: breakdown.sellerWarehouse,
      totalQuantity: breakdown.total,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Cache in-memory de saldo por inventory_id / user_product_id durante um job de sync. */
export class FulfillmentStockCache {
  private readonly inventoryMap = new Map<string, FulfillmentStockFetchResult>();
  private readonly userProductMap = new Map<string, UserProductStockFetchResult>();

  async getStock(inventoryId: string, accessToken: string): Promise<FulfillmentStockFetchResult> {
    const key = inventoryId.trim();
    const cached = this.inventoryMap.get(key);
    if (cached) return cached;
    const result = await getFulfillmentStock(key, accessToken);
    this.inventoryMap.set(key, result);
    return result;
  }

  async getUserProductStock(
    userProductId: string,
    accessToken: string
  ): Promise<UserProductStockFetchResult> {
    const key = userProductId.trim();
    const cached = this.userProductMap.get(key);
    if (cached) return cached;
    const result = await getUserProductMeliFacilityStock(key, accessToken);
    this.userProductMap.set(key, result);
    return result;
  }

  get size(): number {
    return this.inventoryMap.size + this.userProductMap.size;
  }
}

/**
 * Fase A — flags Full sem chamar API de estoque (tags, frete, inventory_id, user_product_id).
 */
export function resolveFulfillmentFieldsFast(
  item: MLItemDetail,
  variationDetails?: MLVariationDetail[]
): FulfillmentItemFields {
  const inventoryIds = collectFulfillmentInventoryIds(item, variationDetails);
  const signals = itemHasFulfillmentSignals(item);
  const userProductId = normalizeUserProductId(item.user_product_id);
  const primaryInventoryId = inventoryIds[0] ?? null;

  if (inventoryIds.length === 0 && !userProductId) {
    return {
      is_fulfillment: signals,
      fulfillment_stock: null,
      inventory_id: null,
    };
  }

  return {
    is_fulfillment: signals || !!userProductId || inventoryIds.length > 0,
    fulfillment_stock: null,
    inventory_id: primaryInventoryId,
  };
}

export function itemHasFulfillmentStockSource(item: Pick<MLItemDetail, "user_product_id">, inventoryIds: string[]): boolean {
  return inventoryIds.length > 0 || !!normalizeUserProductId(item.user_product_id);
}

/** Decide se o estoque Full precisa ser reconsultado na API. */
export function shouldRefreshFulfillmentStock(params: {
  inventoryIds: string[];
  userProductId?: string | null;
  primaryInventoryId: string | null;
  existing?: StoredFulfillmentRow | null;
  force?: boolean;
}): boolean {
  const { inventoryIds, primaryInventoryId, existing, force } = params;
  const userProductId = normalizeUserProductId(params.userProductId);
  if (!itemHasFulfillmentStockSource({ user_product_id: userProductId }, inventoryIds)) return false;
  if (force) return true;
  if (!existing?.fulfillment_synced_at) return true;

  const prevInv = existing.inventory_id?.trim() || null;
  if (prevInv !== primaryInventoryId) return true;

  const prevUp = normalizeUserProductId(existing.user_product_id);
  if (userProductId && prevUp !== userProductId) return true;

  const ttl = getFulfillmentStockTtlMs();
  if (ttl === 0) return true;

  const syncedAt = new Date(existing.fulfillment_synced_at).getTime();
  if (!Number.isFinite(syncedAt)) return true;
  return Date.now() - syncedAt >= ttl;
}

/**
 * Fase B — consulta estoque Full (MLBU via user-products; clássico via inventories).
 */
export async function fetchFulfillmentStockFields(
  item: MLItemDetail,
  accessToken: string,
  variationDetails: MLVariationDetail[] | undefined,
  cache: FulfillmentStockCache
): Promise<FulfillmentStockFieldsResult> {
  const inventoryIds = collectFulfillmentInventoryIds(item, variationDetails);
  const signals = itemHasFulfillmentSignals(item);
  const userProductId = normalizeUserProductId(item.user_product_id);
  const primaryInventoryId = inventoryIds[0] ?? null;
  const byInventory: FulfillmentStockByInventory[] = [];

  if (userProductId) {
    const upStock = await cache.getUserProductStock(userProductId, accessToken);
    if (upStock.ok) {
      const sellerStock = upStock.sellingAddressQuantity + upStock.sellerWarehouseQuantity;
      return {
        is_fulfillment: true,
        fulfillment_stock: upStock.meliFacilityQuantity,
        inventory_id: primaryInventoryId,
        byInventory,
        total_listing_stock: upStock.totalQuantity,
        seller_stock: sellerStock,
      };
    }
  }

  if (inventoryIds.length === 0) {
    return {
      is_fulfillment: signals || !!userProductId,
      fulfillment_stock: null,
      inventory_id: null,
      byInventory,
      total_listing_stock: null,
      seller_stock: null,
    };
  }

  let fullAvailableSum = 0;
  let anyStockOk = false;

  for (const invId of inventoryIds) {
    const stock = await cache.getStock(invId, accessToken);
    if (stock.ok) {
      anyStockOk = true;
      const fullAvail = pickFulfillmentDepotAvailable(stock);
      fullAvailableSum += fullAvail;
      byInventory.push({
        inventory_id: invId,
        depot_quantity: fullAvail,
        available_quantity: stock.availableQuantity,
      });
    }
  }

  if (anyStockOk) {
    return {
      is_fulfillment: true,
      fulfillment_stock: fullAvailableSum,
      inventory_id: primaryInventoryId,
      byInventory,
      total_listing_stock: null,
      seller_stock: null,
    };
  }

  return {
    is_fulfillment: signals || !!userProductId,
    fulfillment_stock: null,
    inventory_id: primaryInventoryId,
    byInventory,
    total_listing_stock: null,
    seller_stock: null,
  };
}

/**
 * Consulta estoque Full para todos os inventory_id do anúncio (item + variações).
 * @deprecated Preferir resolveFulfillmentFieldsFast + fetchFulfillmentStockFields em sync em lote.
 */
export async function fetchFulfillmentFieldsForItem(
  item: MLItemDetail,
  accessToken: string,
  variationDetails?: MLVariationDetail[]
): Promise<FulfillmentItemFields> {
  const cache = new FulfillmentStockCache();
  return fetchFulfillmentStockFields(item, accessToken, variationDetails, cache);
}

/** Estoque total da publicação: Full + próprio quando consultado via user-products. */
export function resolveListingAvailableQuantity(
  itemAvailableQuantity: number | null | undefined,
  stockFields: Pick<FulfillmentStockFieldsResult, "total_listing_stock">
): number | null {
  if (stockFields.total_listing_stock != null) {
    return stockFields.total_listing_stock;
  }
  if (itemAvailableQuantity != null && Number.isFinite(Number(itemAvailableQuantity))) {
    return Math.floor(Number(itemAvailableQuantity));
  }
  return null;
}

/** Persiste estoque Full por variação (inventory_id) após consulta à API. */
export async function persistVariationFulfillmentStocks(
  supabase: { from: (table: string) => unknown },
  accountId: string,
  itemId: string,
  byInventory: FulfillmentStockByInventory[]
): Promise<void> {
  for (const row of byInventory) {
    await (supabase as any)
      .from("ml_variations")
      .update({ fulfillment_stock: row.depot_quantity })
      .eq("account_id", accountId)
      .eq("item_id", itemId)
      .eq("inventory_id", row.inventory_id);
  }
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
