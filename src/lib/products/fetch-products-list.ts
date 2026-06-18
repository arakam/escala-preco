import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkIds, UUID_IN_BATCH } from "@/lib/supabase/batched-in-filter";
import { fetchAllViaRange } from "@/lib/table-pagination";

type ProductRow = Record<string, unknown> & { id: string; created_at?: string };

function applySearchFilter<Q extends { or: Function }>(query: Q, search: string): Q {
  if (!search) return query;
  return query.or(
    `sku.ilike.%${search}%,title.ilike.%${search}%,ean.ilike.%${search}%,supplier.ilike.%${search}%`
  );
}

async function fetchProductsByIdBatches(
  supabase: SupabaseClient,
  userId: string,
  productIds: string[],
  search: string
): Promise<ProductRow[]> {
  const byId = new Map<string, ProductRow>();
  for (const batch of chunkIds(productIds)) {
    let q = supabase.from("products").select("*").eq("user_id", userId).in("id", batch);
    q = applySearchFilter(q, search);
    const { data, error } = await q;
    if (error) throw error;
    for (const row of (data ?? []) as ProductRow[]) {
      byId.set(String(row.id), row);
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );
}

/** Lista produtos paginada, com filtro por ids em lotes (evita `.in()` gigante no PostgREST). */
export async function fetchProductsListPage(
  supabase: SupabaseClient,
  userId: string,
  options: {
    search: string;
    productIds: string[] | null;
    page: number;
    limit: number;
    showAll: boolean;
  }
): Promise<{ rows: ProductRow[]; total: number; error: unknown }> {
  const { search, productIds, page, limit, showAll } = options;
  const offset = (page - 1) * limit;
  const needsBatchById = productIds != null && productIds.length > UUID_IN_BATCH;

  if (needsBatchById) {
    try {
      const all = await fetchProductsByIdBatches(supabase, userId, productIds, search);
      const total = all.length;
      if (showAll) return { rows: all, total, error: null };
      return { rows: all.slice(offset, offset + limit), total, error: null };
    } catch (error) {
      return { rows: [], total: 0, error };
    }
  }

  const buildBaseQuery = () => {
    let q = supabase
      .from("products")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    q = applySearchFilter(q, search);
    if (productIds) {
      q = q.in("id", productIds);
    }
    return q;
  };

  if (showAll) {
    const { rows, total, error } = await fetchAllViaRange<ProductRow>((from, to) =>
      buildBaseQuery().range(from, to)
    );
    return { rows, total, error };
  }

  const { data, error, count } = await buildBaseQuery().range(offset, offset + limit - 1);
  return { rows: (data ?? []) as ProductRow[], total: count ?? 0, error };
}
