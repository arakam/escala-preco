import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveProductIdsByTagIds } from "@/lib/product-tags";

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
    const tagIds = await resolveProductIdsByTagIds(supabase, filters.tagIds);
    if (tagIds.length === 0) return [];
    allowed = new Set(tagIds);
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
