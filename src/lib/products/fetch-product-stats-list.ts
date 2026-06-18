import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkIds, UUID_IN_BATCH } from "@/lib/supabase/batched-in-filter";
import { fetchAllViaRange } from "@/lib/table-pagination";

type StatsRow = Record<string, unknown> & { product_id: string };

async function fetchStatsByProductIdBatches(
  supabase: SupabaseClient,
  userId: string,
  productIds: string[],
  search: string,
  sortColumn: string,
  sortAscending: boolean
): Promise<StatsRow[]> {
  const byProductId = new Map<string, StatsRow>();
  for (const batch of chunkIds(productIds)) {
    let q = supabase
      .from("product_listing_stats")
      .select("*")
      .eq("user_id", userId)
      .in("product_id", batch);
    if (search) {
      q = q.or(`sku.ilike.%${search}%,title.ilike.%${search}%`);
    }
    const { data, error } = await q;
    if (error) throw error;
    for (const row of (data ?? []) as StatsRow[]) {
      byProductId.set(String(row.product_id), row);
    }
  }
  const rows = Array.from(byProductId.values());
  rows.sort((a, b) => {
    const av = a[sortColumn];
    const bv = b[sortColumn];
    if (av == null && bv == null) return 0;
    if (av == null) return sortAscending ? -1 : 1;
    if (bv == null) return sortAscending ? 1 : -1;
    if (typeof av === "number" && typeof bv === "number") {
      return sortAscending ? av - bv : bv - av;
    }
    return sortAscending
      ? String(av).localeCompare(String(bv), "pt-BR")
      : String(bv).localeCompare(String(av), "pt-BR");
  });
  return rows;
}

/** Estatísticas de anúncios por produto, paginada, com filtro por ids em lotes. */
export async function fetchProductStatsListPage(
  supabase: SupabaseClient,
  userId: string,
  options: {
    search: string;
    productIds: string[] | null;
    page: number;
    limit: number;
    showAll: boolean;
    sortColumn: string;
    sortAscending: boolean;
  }
): Promise<{ rows: StatsRow[]; total: number; error: unknown }> {
  const { search, productIds, page, limit, showAll, sortColumn, sortAscending } = options;
  const offset = (page - 1) * limit;
  const needsBatchById = productIds != null && productIds.length > UUID_IN_BATCH;

  if (needsBatchById) {
    try {
      const all = await fetchStatsByProductIdBatches(
        supabase,
        userId,
        productIds,
        search,
        sortColumn,
        sortAscending
      );
      const total = all.length;
      if (showAll) return { rows: all, total, error: null };
      return { rows: all.slice(offset, offset + limit), total, error: null };
    } catch (error) {
      return { rows: [], total: 0, error };
    }
  }

  const buildBaseQuery = () => {
    let q = supabase
      .from("product_listing_stats")
      .select("*", { count: "exact" })
      .eq("user_id", userId);
    if (search) {
      q = q.or(`sku.ilike.%${search}%,title.ilike.%${search}%`);
    }
    if (productIds) {
      q = q.in("product_id", productIds);
    }
    return q.order(sortColumn, { ascending: sortAscending });
  };

  if (showAll) {
    const { rows, total, error } = await fetchAllViaRange<StatsRow>((from, to) =>
      buildBaseQuery().range(from, to)
    );
    return { rows, total, error };
  }

  const { data, error, count } = await buildBaseQuery().range(offset, offset + limit - 1);
  return { rows: (data ?? []) as StatsRow[], total: count ?? 0, error };
}
