import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveMlItemIdsByFulfillment,
  resolveProductIdsForListFilters,
} from "@/lib/product-filters";
import { resolveMlItemIdsByEffectiveProductTagIds } from "@/lib/product-tags";
import { applyBatchedInFilter as applyColumnInFilter, chunkIds, UUID_IN_BATCH } from "@/lib/supabase/batched-in-filter";
import { fetchAllRowsByColumnInBatches } from "@/lib/listing-tag-filter";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CacheQuery = any;

export type PricingListingIdFilters = {
  allowedProductIds: string[] | null;
  allowedItemIds: string[] | null;
};

/** Resolve filtros de produto/tag para pricing_cache (produto efetivo + Full). */
export async function resolvePricingListingIdFilters(
  serviceSupabase: SupabaseClient,
  accountId: string,
  userId: string,
  options: {
    tagIds: string[];
    supplierFilter: string;
    hasPma: "" | "yes" | "no";
    fullOnly: boolean;
  }
): Promise<PricingListingIdFilters> {
  let allowedProductIds: string[] | null = null;
  let allowedItemIds: string[] | null = null;

  const hasTagFilter = options.tagIds.length > 0;
  const hasProductFilter = Boolean(options.supplierFilter) || options.hasPma !== "";

  if (hasTagFilter && !hasProductFilter) {
    allowedItemIds = await resolveMlItemIdsByEffectiveProductTagIds(
      serviceSupabase,
      accountId,
      userId,
      options.tagIds
    );
    if (allowedItemIds !== null && allowedItemIds.length === 0) {
      return { allowedProductIds: [], allowedItemIds: [] };
    }
  } else if (hasTagFilter || hasProductFilter) {
    allowedProductIds = await resolveProductIdsForListFilters(serviceSupabase, userId, {
      tagIds: options.tagIds,
      supplier: options.supplierFilter,
      hasPma: options.hasPma,
    });
    if (allowedProductIds !== null && allowedProductIds.length === 0) {
      return { allowedProductIds: [], allowedItemIds: null };
    }
  }

  if (options.fullOnly) {
    const fullItemIds = await resolveMlItemIdsByFulfillment(serviceSupabase, accountId);
    if (fullItemIds.length === 0) {
      return { allowedProductIds: [], allowedItemIds: [] };
    }
    if (allowedItemIds) {
      const fullSet = new Set(fullItemIds.map((id) => id.trim().toUpperCase()));
      allowedItemIds = allowedItemIds.filter((id) => fullSet.has(id.trim().toUpperCase()));
      if (allowedItemIds.length === 0) {
        return { allowedProductIds: [], allowedItemIds: [] };
      }
    } else {
      allowedItemIds = fullItemIds;
    }
  }

  return { allowedProductIds, allowedItemIds };
}

/** Aplica filtros por product_id / item_id em lotes (PostgREST). Retorna null se precisar buscar em lotes separados. */
export function applyPricingListingIdFilters(
  query: CacheQuery,
  idFilters: Pick<PricingListingIdFilters, "allowedProductIds" | "allowedItemIds">
): CacheQuery | null {
  let q = query;
  if (idFilters.allowedProductIds) {
    const next = applyColumnInFilter(q, "product_id", idFilters.allowedProductIds);
    if (!next) return null;
    q = next;
  }
  if (idFilters.allowedItemIds) {
    const next = applyColumnInFilter(q, "item_id", idFilters.allowedItemIds);
    if (!next) return null;
    q = next;
  }
  return q;
}
/** Busca linhas do cache quando há muitos ids para um `.in()` / `.or()` único. */
export async function fetchPricingCacheRowsByIdBatches<R extends Record<string, unknown>>(
  buildBatchQuery: (idColumn: "item_id" | "product_id", batch: string[]) => CacheQuery,
  idFilters: Pick<PricingListingIdFilters, "allowedProductIds" | "allowedItemIds">,
  selectColumns: string
): Promise<{ rows: R[]; error: unknown }> {
  const idColumn: "item_id" | "product_id" = idFilters.allowedItemIds ? "item_id" : "product_id";
  const ids = idFilters.allowedItemIds ?? idFilters.allowedProductIds ?? [];
  return fetchAllRowsByColumnInBatches<R>(buildBatchQuery, idColumn, ids, selectColumns);
}

export function pricingListingIdFiltersNeedBatchFetch(
  idFilters: Pick<PricingListingIdFilters, "allowedProductIds" | "allowedItemIds">
): boolean {
  const ids = idFilters.allowedItemIds ?? idFilters.allowedProductIds;
  return ids != null && ids.length > UUID_IN_BATCH;
}
