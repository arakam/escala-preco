import type { SupabaseClient } from "@supabase/supabase-js";
import {
  intersectMlItemIdFilters,
  resolveMlItemIdsByFulfillment,
  resolveMlItemIdsByProductSupplier,
} from "@/lib/product-filters";
import { resolveMlItemIdsByProductTagIds } from "@/lib/product-tags";
import { fetchAllViaRange } from "@/lib/table-pagination";
import { applyNumericCompareFilter } from "@/lib/pricing/listings-query-filters";
import type { PricingListingsQueryParams } from "@/lib/pricing/listings-query-params";

export type PricingCacheRow = Record<string, unknown>;

/**
 * Todas as linhas de pricing_cache que batem com os filtros da tela de Preços (sem paginação).
 */
export async function fetchAllPricingCacheRowsForFilters(
  serviceSupabase: SupabaseClient,
  accountId: string,
  userId: string,
  filters: PricingListingsQueryParams
): Promise<{ rows: PricingCacheRow[]; error: unknown }> {
  let allowedItemIds: string[] | null = null;
  if (filters.tagIds.length > 0 || filters.supplierFilter || filters.fullOnly) {
    try {
      const byTags =
        filters.tagIds.length > 0
          ? await resolveMlItemIdsByProductTagIds(serviceSupabase, accountId, filters.tagIds)
          : null;
      const bySupplier = filters.supplierFilter
        ? await resolveMlItemIdsByProductSupplier(
            serviceSupabase,
            accountId,
            userId,
            filters.supplierFilter
          )
        : null;
      const byFull = filters.fullOnly
        ? await resolveMlItemIdsByFulfillment(serviceSupabase, accountId)
        : null;
      allowedItemIds = intersectMlItemIdFilters(
        intersectMlItemIdFilters(byTags, bySupplier),
        byFull
      );
      if (allowedItemIds !== null && allowedItemIds.length === 0) {
        return { rows: [], error: null };
      }
    } catch (e) {
      return { rows: [], error: e };
    }
  }

  const buildCacheQuery = (base: ReturnType<typeof serviceSupabase.from>) => {
    let q = base.select("*").eq("account_id", accountId);
    if (filters.statusFilter) q = q.eq("status", filters.statusFilter);
    if (filters.linkedParam === "1") q = q.not("product_id", "is", null);
    else if (filters.linkedParam === "0") q = q.is("product_id", null);
    if (filters.search) q = q.or(`title.ilike.%${filters.search}%,item_id.ilike.%${filters.search}%`);
    if (filters.skuFilter) q = q.ilike("sku", `%${filters.skuFilter}%`);
    if (filters.onlyWithSales30d) q = q.gt("orders_30d", 0);
    if (filters.orders30dFilter) {
      q = applyNumericCompareFilter(q, "orders_30d", filters.orders30dFilter.op, filters.orders30dFilter.qty);
    }
    if (filters.costFilter) {
      q = q.not("cost_price", "is", null);
      q = applyNumericCompareFilter(q, "cost_price", filters.costFilter.op, filters.costFilter.qty);
    }
    if (filters.discountFilter) {
      q = q.not("discount_percent", "is", null);
      q = applyNumericCompareFilter(q, "discount_percent", filters.discountFilter.op, filters.discountFilter.qty);
    }
    if (filters.profitFilter) {
      q = q.not("profit_margin_percent", "is", null);
      q = applyNumericCompareFilter(
        q,
        "profit_margin_percent",
        filters.profitFilter.op,
        filters.profitFilter.qty
      );
    }
    if (filters.semPromoMlAtiva) {
      q = q.or("ml_active_promotions.is.null,ml_active_promotions.eq.");
    }
    if (allowedItemIds) q = q.in("item_id", allowedItemIds);
    return q;
  };

  let q = buildCacheQuery(serviceSupabase.from("pricing_cache"));
  if (filters.orderBy === "orders_desc") q = q.order("orders_30d", { ascending: false });
  else if (filters.orderBy === "orders_asc") q = q.order("orders_30d", { ascending: true });
  else if (filters.orderBy === "cost_desc") {
    q = q.order("cost_price", { ascending: false, nullsFirst: true });
  } else if (filters.orderBy === "cost_asc") {
    q = q.order("cost_price", { ascending: true, nullsFirst: true });
  } else if (filters.orderBy === "profit_desc") {
    q = q.order("profit_margin_percent", { ascending: false, nullsFirst: true });
  } else if (filters.orderBy === "profit_asc") {
    q = q.order("profit_margin_percent", { ascending: true, nullsFirst: true });
  } else q = q.order("sort_title", { ascending: true });

  const batchResult = await fetchAllViaRange<PricingCacheRow>((from, to) => q.range(from, to));
  return { rows: batchResult.rows, error: batchResult.error };
}
