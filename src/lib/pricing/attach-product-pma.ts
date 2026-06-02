import type { SupabaseClient } from "@supabase/supabase-js";

/** Anexa `products.pma` via `product_id` já presente na linha (ex.: pricing_cache). */
export async function attachProductPmaToRows<T extends { product_id: string | null }>(
  supabase: SupabaseClient,
  rows: T[]
): Promise<(T & { pma: number | null })[]> {
  if (rows.length === 0) return [];

  const productIds = Array.from(
    new Set(
      rows
        .map((r) => r.product_id)
        .filter((id): id is string => id != null && String(id).trim() !== "")
        .map((id) => String(id))
    )
  );

  const pmaByProductId = new Map<string, number>();
  if (productIds.length > 0) {
    const { data: products, error } = await supabase
      .from("products")
      .select("id, pma")
      .in("id", productIds);
    if (error) {
      console.warn("[pricing] attachProductPma products", error);
    } else {
      for (const p of products ?? []) {
        const id = String((p as { id?: string }).id ?? "");
        const pma = Number((p as { pma?: number | string | null }).pma);
        if (id && Number.isFinite(pma) && pma > 0) {
          pmaByProductId.set(id, Math.round(pma * 100) / 100);
        }
      }
    }
  }

  return rows.map((row) => {
    const pid = row.product_id != null ? String(row.product_id) : "";
    return {
      ...row,
      pma: pid ? pmaByProductId.get(pid) ?? null : null,
    };
  });
}
