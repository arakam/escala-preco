import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMlItemIdsByProductIds, resolveProductIdsByTagIds } from "@/lib/product-tags";
import { fetchAllViaRange } from "@/lib/table-pagination";

export type ProductHasPmaFilter = "yes" | "no" | "";

export type ProductListFilters = {
  supplier: string;
  hasPma: ProductHasPmaFilter;
  tagIds: string[];
};

export function parseHasPmaParam(value: string | null | undefined): ProductHasPmaFilter {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "yes" || v === "true" || v === "1" || v === "com" || v === "sim") return "yes";
  if (v === "no" || v === "false" || v === "0" || v === "sem" || v === "nao" || v === "não")
    return "no";
  return "";
}

export function parseProductListFilters(searchParams: URLSearchParams): ProductListFilters {
  const tagIdsParam = searchParams.get("tags")?.trim() || "";
  return {
    supplier: searchParams.get("supplier")?.trim() || "",
    hasPma: parseHasPmaParam(searchParams.get("has_pma")),
    tagIds: tagIdsParam ? tagIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [],
  };
}

export function applyProductFiltersToQuery<Q extends { ilike: Function; not: Function; is: Function }>(
  query: Q,
  filters: Pick<ProductListFilters, "supplier" | "hasPma">
): Q {
  let q = query;
  if (filters.supplier) {
    q = q.ilike("supplier", `%${filters.supplier}%`);
  }
  if (filters.hasPma === "yes") {
    q = q.not("pma", "is", null);
  } else if (filters.hasPma === "no") {
    q = q.is("pma", null);
  }
  return q;
}

/** Tags (OR) + fornecedor + PMA (AND). Retorna null = sem restrição por id. */
export async function resolveProductIdsForListFilters(
  supabase: SupabaseClient,
  userId: string,
  filters: ProductListFilters
): Promise<string[] | null> {
  const needsTagFilter = filters.tagIds.length > 0;
  const needsProductFilter = Boolean(filters.supplier) || filters.hasPma !== "";

  if (!needsTagFilter && !needsProductFilter) return null;

  let allowed: Set<string> | null = null;

  if (needsTagFilter) {
    const productIdsFromTags = await resolveProductIdsByTagIds(
      supabase,
      filters.tagIds,
      userId
    );
    if (productIdsFromTags.length === 0) return [];
    allowed = new Set(productIdsFromTags);
  }

  if (needsProductFilter) {
    let q = supabase.from("products").select("id").eq("user_id", userId);
    q = applyProductFiltersToQuery(q, filters);
    const { data, error } = await q;
    if (error) throw error;
    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    if (allowed) {
      const intersected = Array.from(allowed).filter((id) => idSet.has(id));
      if (intersected.length === 0) return [];
      allowed = new Set(intersected);
    } else {
      allowed = idSet;
    }
  }

  return allowed ? Array.from(allowed) : null;
}

/**
 * MLB da conta cujo produto vinculado bate com o fornecedor (ilike parcial).
 * Retorna `null` se supplier vazio (sem filtro); `[]` se nenhum anúncio bate.
 */
export async function resolveMlItemIdsByProductSupplier(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  supplier: string
): Promise<string[] | null> {
  const trimmed = supplier.trim();
  if (!trimmed) return null;

  let q = supabase.from("products").select("id").eq("user_id", userId);
  q = applyProductFiltersToQuery(q, { supplier: trimmed, hasPma: "" });
  const { data, error } = await q;
  if (error) throw error;

  const productIds = (data ?? []).map((r: { id: string }) => r.id);
  if (productIds.length === 0) return [];

  return resolveMlItemIdsByProductIds(supabase, accountId, productIds);
}

/** MLB da conta cujo produto vinculado tem ou não PMA cadastrado. */
export async function resolveMlItemIdsByProductHasPma(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  hasPma: ProductHasPmaFilter
): Promise<string[] | null> {
  if (!hasPma) return null;

  let q = supabase.from("products").select("id").eq("user_id", userId);
  q = applyProductFiltersToQuery(q, { supplier: "", hasPma });
  const { data, error } = await q;
  if (error) throw error;

  const productIds = (data ?? []).map((r: { id: string }) => r.id);
  if (productIds.length === 0) return [];

  return resolveMlItemIdsByProductIds(supabase, accountId, productIds);
}

/** MLB da conta marcados como Full em ml_items (is_fulfillment). */
export async function resolveMlItemIdsByFulfillment(
  supabase: SupabaseClient,
  accountId: string
): Promise<string[]> {
  const { rows, error } = await fetchAllViaRange<{ item_id: string }>((from, to) =>
    supabase
      .from("ml_items")
      .select("item_id")
      .eq("account_id", accountId)
      .eq("is_fulfillment", true)
      .range(from, to)
  );
  if (error) throw error;
  return rows.map((r) => r.item_id);
}

/** Interseção de listas de item_id (null = sem restrição). */
export function intersectMlItemIdFilters(
  a: string[] | null,
  b: string[] | null
): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  if (a.length === 0 || b.length === 0) return [];
  const setB = new Set(b);
  return a.filter((id) => setB.has(id));
}
