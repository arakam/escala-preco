import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMlItemIdsByEffectiveProductTagIds } from "@/lib/product-tags";
import {
  applyBatchedInFilter,
  chunkIds,
  UUID_OR_BATCH_MAX,
} from "@/lib/supabase/batched-in-filter";
import { fetchAllViaRange } from "@/lib/table-pagination";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FilterQuery = any;

/** MLB cuja linha usa produto efetivo com alguma das tags (OR). */
export async function resolveListingTagItemIds(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  tagIds: string[]
): Promise<string[] | null> {
  if (tagIds.length === 0) return null;
  return (await resolveMlItemIdsByEffectiveProductTagIds(supabase, accountId, userId, tagIds)) ?? [];
}

/** Lista de ids grande demais para um único `.in()` / `.or()` no PostgREST. */
export function itemIdsNeedBatchFetch(itemIds: string[]): boolean {
  if (itemIds.length === 0) return false;
  return chunkIds(itemIds).length > UUID_OR_BATCH_MAX;
}

/**
 * Aplica filtro `item_id IN (...)` em lotes pequenos.
 * Retorna `null` se precisar buscar em lotes separados (caller usa {@link fetchAllRowsByItemIdBatches}).
 */
export function applyAllowedItemIdsFilter(
  query: FilterQuery,
  allowedItemIds: string[] | null | undefined
): FilterQuery | null {
  if (!allowedItemIds || allowedItemIds.length === 0) {
    if (allowedItemIds?.length === 0) {
      return query.eq("item_id", "__NO_MATCH__");
    }
    return query;
  }
  const next = applyBatchedInFilter(query, "item_id", allowedItemIds);
  return next;
}

/** Aplica filtro `product_id IN (...)` em lotes pequenos. */
export function applyAllowedProductIdsFilter(
  query: FilterQuery,
  allowedProductIds: string[] | null | undefined
): FilterQuery | null {
  if (!allowedProductIds || allowedProductIds.length === 0) {
    if (allowedProductIds?.length === 0) {
      return query.eq("product_id", "__NO_MATCH__");
    }
    return query;
  }
  return applyBatchedInFilter(query, "product_id", allowedProductIds);
}

function rowDedupeKey(row: Record<string, unknown>): string {
  if (row.id != null) return String(row.id);
  const itemId = row.item_id != null ? String(row.item_id) : "";
  const variationId = row.variation_id != null ? String(row.variation_id) : "";
  return `${itemId}:${variationId}`;
}

/** Busca todas as linhas paginando `.in(column, batch)` em lotes de ids. */
export async function fetchAllRowsByColumnInBatches<R extends Record<string, unknown>>(
  buildBatchQuery: (column: "item_id" | "product_id", batch: string[]) => FilterQuery,
  column: "item_id" | "product_id",
  ids: string[],
  selectColumns: string
): Promise<{ rows: R[]; error: unknown }> {
  const byKey = new Map<string, R>();

  try {
    for (const batch of chunkIds(ids)) {
      const q = buildBatchQuery(column, batch);
      const { rows, error } = await fetchAllViaRange<R>((from, to) =>
        q.select(selectColumns).range(from, to)
      );
      if (error) return { rows: [], error };
      for (const row of rows) {
        byKey.set(rowDedupeKey(row), row);
      }
    }
    return { rows: Array.from(byKey.values()), error: null };
  } catch (error) {
    return { rows: [], error };
  }
}

/** Conta linhas com filtro `item_id IN (...)` em lotes quando necessário. */
export async function countRowsWithItemIdFilter(
  buildBaseCountQuery: () => FilterQuery,
  allowedItemIds: string[]
): Promise<{ count: number; error: unknown }> {
  if (allowedItemIds.length === 0) return { count: 0, error: null };

  const filtered = applyAllowedItemIdsFilter(buildBaseCountQuery(), allowedItemIds);
  if (filtered) {
    const { count, error } = await filtered;
    return { count: count ?? 0, error };
  }

  let total = 0;
  for (const batch of chunkIds(allowedItemIds)) {
    const { count, error } = await buildBaseCountQuery().in("item_id", batch);
    if (error) return { count: 0, error };
    total += count ?? 0;
  }
  return { count: total, error: null };
}

/** Lista `item_id` paginada de `ml_items` respeitando filtro por tags em lotes. */
export async function fetchMlItemIdsPageWithTagFilter(
  buildBaseQuery: () => FilterQuery,
  allowedItemIds: string[],
  from: number,
  to: number
): Promise<{ itemIds: string[]; error: unknown }> {
  if (allowedItemIds.length === 0) return { itemIds: [], error: null };

  const filtered = applyAllowedItemIdsFilter(buildBaseQuery(), allowedItemIds);
  if (filtered) {
    const { data, error } = await filtered.select("item_id").range(from, to);
    if (error) return { itemIds: [], error };
    const ids = Array.from(
      new Set((data ?? []).map((r: { item_id: string }) => String(r.item_id)))
    ) as string[];
    return { itemIds: ids, error: null };
  }

  const { rows, error } = await fetchAllRowsByColumnInBatches<{ item_id: string; updated_at?: string }>(
    (_col, batch) => buildBaseQuery().in("item_id", batch),
    "item_id",
    allowedItemIds,
    "item_id, updated_at"
  );
  if (error) return { itemIds: [], error };

  const sorted = rows
    .sort((a, b) => {
      const ta = a.updated_at ? Date.parse(String(a.updated_at)) : 0;
      const tb = b.updated_at ? Date.parse(String(b.updated_at)) : 0;
      return tb - ta;
    })
    .map((row) => String(row.item_id));
  return { itemIds: sorted.slice(from, to + 1), error: null };
}
