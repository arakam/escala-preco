import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllViaRange } from "@/lib/table-pagination";
import { applyNumericCompareFilter } from "@/lib/pricing/listings-query-filters";
import type { PricingListingsQueryParams } from "@/lib/pricing/listings-query-params";
import {
  applyPricingListingIdFilters,
  fetchPricingCacheRowsByIdBatches,
  resolvePricingListingIdFilters,
} from "@/lib/pricing/resolve-listing-filters";
import { sortPricingCacheRows, type PricingCacheRow } from "@/lib/pricing/sort-pricing-cache-rows";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CacheQuery = any;

function applyCommonCacheFilters(
  q: CacheQuery,
  accountId: string,
  filters: PricingListingsQueryParams
): CacheQuery {
  let query = q.eq("account_id", accountId);
  if (filters.statusFilter) query = query.eq("status", filters.statusFilter);
  if (filters.linkedParam === "1") query = query.not("product_id", "is", null);
  else if (filters.linkedParam === "0") query = query.is("product_id", null);
  if (filters.search) {
    query = query.or(`title.ilike.%${filters.search}%,item_id.ilike.%${filters.search}%`);
  }
  if (filters.skuFilter) query = query.ilike("sku", `%${filters.skuFilter}%`);
  if (filters.onlyWithSales30d) query = query.gt("orders_30d", 0);
  if (filters.orders30dFilter) {
    query = applyNumericCompareFilter(query, "orders_30d", filters.orders30dFilter.op, filters.orders30dFilter.qty);
  }
  if (filters.costFilter) {
    query = query.not("cost_price", "is", null);
    query = applyNumericCompareFilter(query, "cost_price", filters.costFilter.op, filters.costFilter.qty);
  }
  if (filters.discountFilter) {
    query = query.not("discount_percent", "is", null);
    query = applyNumericCompareFilter(query, "discount_percent", filters.discountFilter.op, filters.discountFilter.qty);
  }
  if (filters.profitFilter) {
    query = query.not("profit_margin_percent", "is", null);
    query = applyNumericCompareFilter(
      query,
      "profit_margin_percent",
      filters.profitFilter.op,
      filters.profitFilter.qty
    );
  }
  if (filters.semPromoMlAtiva) {
    query = query.or("ml_active_promotions.is.null,ml_active_promotions.eq.");
  }
  return query;
}

function applyCacheSort(q: CacheQuery, orderBy: string): CacheQuery {
  if (orderBy === "orders_desc") return q.order("orders_30d", { ascending: false });
  if (orderBy === "orders_asc") return q.order("orders_30d", { ascending: true });
  if (orderBy === "cost_desc") return q.order("cost_price", { ascending: false, nullsFirst: true });
  if (orderBy === "cost_asc") return q.order("cost_price", { ascending: true, nullsFirst: true });
  if (orderBy === "profit_desc") {
    return q.order("profit_margin_percent", { ascending: false, nullsFirst: true });
  }
  if (orderBy === "profit_asc") {
    return q.order("profit_margin_percent", { ascending: true, nullsFirst: true });
  }
  return q.order("sort_title", { ascending: true });
}

export type { PricingCacheRow };

/**
 * Todas as linhas de pricing_cache que batem com os filtros da tela de Preços (sem paginação).
 */
export async function fetchAllPricingCacheRowsForFilters(
  serviceSupabase: SupabaseClient,
  accountId: string,
  userId: string,
  filters: PricingListingsQueryParams
): Promise<{ rows: PricingCacheRow[]; error: unknown }> {
  let idFilters;
  try {
    idFilters = await resolvePricingListingIdFilters(serviceSupabase, accountId, userId, {
      tagIds: filters.tagIds,
      supplierFilter: filters.supplierFilter,
      hasPma: filters.hasPma,
      fullOnly: filters.fullOnly,
    });
    if (
      idFilters.allowedProductIds?.length === 0 ||
      idFilters.allowedItemIds?.length === 0
    ) {
      return { rows: [], error: null };
    }
  } catch (e) {
    return { rows: [], error: e };
  }

  const buildBaseQuery = () =>
    applyCommonCacheFilters(serviceSupabase.from("pricing_cache").select("*"), accountId, filters);

  const withIdFilters = applyPricingListingIdFilters(buildBaseQuery(), idFilters);
  if (!withIdFilters) {
    const { rows, error } = await fetchPricingCacheRowsByIdBatches(
      (idColumn, batch) => {
        let q = applyCommonCacheFilters(
          serviceSupabase.from("pricing_cache").select("*"),
          accountId,
          filters
        );
        return q.in(idColumn, batch);
      },
      idFilters,
      "*"
    );
    if (error) return { rows: [], error };
    return { rows: sortPricingCacheRows(rows, filters.orderBy), error: null };
  }

  const q = applyCacheSort(withIdFilters, filters.orderBy);
  const batchResult = await fetchAllViaRange<PricingCacheRow>((from, to) => q.range(from, to));
  return { rows: batchResult.rows, error: batchResult.error };
}
