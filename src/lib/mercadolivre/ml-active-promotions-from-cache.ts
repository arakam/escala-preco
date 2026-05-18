import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMlActivePromotionsStorageTextFromDisplayRows,
  type SellerPromotionDisplayRow,
} from "@/lib/mercadolivre/seller-promotions-item";

type PromoCacheSlice = Pick<SellerPromotionDisplayRow, "label" | "promo_price" | "value_hint">;

const CANONICAL_CACHE_SEARCH = "";
const CANONICAL_LINK_FILTER = "all";
const PAGE_SIZE = 1000;

function itemKey(itemId: string): string {
  return String(itemId).trim().toUpperCase();
}

type PromoCacheDbRow = {
  item_id: string;
  promotion_label: string | null;
  value_hint: string | null;
  promo_price: number | null;
  row_key: string;
  snapshot_at: string | null;
  promotion_kind: string;
};

async function fetchPromoCacheRows(
  supabase: SupabaseClient,
  accountId: string,
  filters: {
    cacheSearch?: string;
    cacheLinkFilter?: string;
    promotionKind?: string;
    itemIds?: string[];
  }
): Promise<PromoCacheDbRow[]> {
  const out: PromoCacheDbRow[] = [];
  let from = 0;
  while (true) {
    let q = supabase
      .from("promotions_cache_rows")
      .select(
        "item_id, promotion_label, value_hint, promo_price, row_key, snapshot_at, promotion_kind"
      )
      .eq("account_id", accountId);
    if (filters.cacheSearch !== undefined) q = q.eq("cache_search", filters.cacheSearch);
    if (filters.cacheLinkFilter !== undefined) q = q.eq("cache_link_filter", filters.cacheLinkFilter);
    if (filters.promotionKind) q = q.eq("promotion_kind", filters.promotionKind);
    if (filters.itemIds?.length) q = q.in("item_id", filters.itemIds);
    const { data, error } = await q.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const list = (data ?? []) as PromoCacheDbRow[];
    out.push(...list);
    if (list.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

function dedupePromoCacheRowsByRowKey(rows: PromoCacheDbRow[]): PromoCacheDbRow[] {
  const byKey = new Map<string, PromoCacheDbRow>();
  for (const row of rows) {
    const rk = String(row.row_key);
    const prev = byKey.get(rk);
    const t = row.snapshot_at ? new Date(row.snapshot_at).getTime() : 0;
    const pt = prev?.snapshot_at ? new Date(prev.snapshot_at).getTime() : -1;
    if (!prev || t >= pt) byKey.set(rk, row);
  }
  return Array.from(byKey.values());
}

function promoCacheRowsToMap(rows: PromoCacheDbRow[]): Map<string, string> {
  const byItem = new Map<string, PromoCacheSlice[]>();
  for (const r of rows) {
    if (r.promotion_kind !== "ativa") continue;
    const key = itemKey(r.item_id);
    const slice: PromoCacheSlice = {
      label: String(r.promotion_label ?? "").trim() || "Promoção",
      promo_price: r.promo_price != null && Number.isFinite(Number(r.promo_price)) ? Number(r.promo_price) : null,
      value_hint: r.value_hint?.trim() ? r.value_hint.trim() : null,
    };
    const arr = byItem.get(key);
    if (arr) arr.push(slice);
    else byItem.set(key, [slice]);
  }
  const out = new Map<string, string>();
  for (const [key, slices] of Array.from(byItem.entries())) {
    out.set(key, buildMlActivePromotionsStorageTextFromDisplayRows(slices));
  }
  return out;
}

/**
 * Carrega promoções ativas por MLB a partir de `promotions_cache_rows` (sem chamar a API do ML).
 * Prioriza snapshot da lista geral (`cache_search` vazio, vínculo `all`); para itens ausentes, busca fallback por `item_id`.
 */
export async function loadMlActivePromotionsByItemIdFromPromotionsCache(
  supabase: SupabaseClient,
  accountId: string,
  itemIds?: string[]
): Promise<Map<string, string>> {
  const uniqueIds = itemIds?.length
    ? Array.from(new Set(itemIds.map(itemKey).filter(Boolean)))
    : undefined;

  let rows = await fetchPromoCacheRows(supabase, accountId, {
    cacheSearch: CANONICAL_CACHE_SEARCH,
    cacheLinkFilter: CANONICAL_LINK_FILTER,
    promotionKind: "ativa",
    itemIds: uniqueIds,
  });
  rows = dedupePromoCacheRowsByRowKey(rows);
  const map = promoCacheRowsToMap(rows);

  if (!uniqueIds?.length) return map;

  const missing = uniqueIds.filter((id) => !map.has(id));
  if (missing.length === 0) return map;

  const BATCH = 80;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const fb = await fetchPromoCacheRows(supabase, accountId, {
      cacheLinkFilter: CANONICAL_LINK_FILTER,
      promotionKind: "ativa",
      itemIds: batch,
    });
    const partial = promoCacheRowsToMap(dedupePromoCacheRowsByRowKey(fb));
    for (const [k, v] of Array.from(partial.entries())) map.set(k, v);
  }
  return map;
}

/** Atualiza só `ml_active_promotions` em `pricing_cache` (ex.: após refresh na tela Promoções). */
export async function patchPricingCacheMlActivePromotions(
  supabase: SupabaseClient,
  accountId: string,
  byItemId: Map<string, string>
): Promise<void> {
  if (byItemId.size === 0) return;
  const entries = Array.from(byItemId.entries());
  const BATCH = 40;
  for (let i = 0; i < entries.length; i += BATCH) {
    const slice = entries.slice(i, i + BATCH);
    await Promise.all(
      slice.map(([itemId, text]) =>
        supabase
          .from("pricing_cache")
          .update({ ml_active_promotions: text || null })
          .eq("account_id", accountId)
          .eq("item_id", itemId)
          .eq("variation_id", -1)
      )
    );
  }
}

/** Monta mapa MLB → texto a partir das linhas achatadas do refresh de promoções. */
export function buildMlActivePromotionsMapFromFlatPromoRows(
  flat: Array<{
    item_id: string;
    promotion_kind: "ativa" | "possível" | "—";
    promotion_label: string;
    promo_price: number | null;
    value_hint: string | null;
  }>
): Map<string, string> {
  const byItem = new Map<string, PromoCacheSlice[]>();
  for (const f of flat) {
    if (f.promotion_kind !== "ativa") continue;
    const key = itemKey(f.item_id);
    const slice: PromoCacheSlice = {
      label: String(f.promotion_label ?? "").trim() || "Promoção",
      promo_price: f.promo_price,
      value_hint: f.value_hint?.trim() ? f.value_hint.trim() : null,
    };
    const arr = byItem.get(key);
    if (arr) arr.push(slice);
    else byItem.set(key, [slice]);
  }
  const out = new Map<string, string>();
  for (const [key, slices] of Array.from(byItem.entries())) {
    out.set(key, buildMlActivePromotionsStorageTextFromDisplayRows(slices));
  }
  return out;
}
