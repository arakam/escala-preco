import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllViaRange } from "@/lib/table-pagination";

/** UUIDs no `.in()` do PostgREST estouram o limite de ~16KB de headers HTTP (~50 por lote). */
const PRODUCT_IN_BATCH = 50;
/** Acima disso, busca todos os produtos do usuário em páginas (sem `.in()` gigante). */
const PRODUCT_BULK_THRESHOLD = 50;

async function loadPmaByProductId(
  supabase: SupabaseClient,
  productIds: string[],
  userId?: string
): Promise<Map<string, number>> {
  const pmaByProductId = new Map<string, number>();

  const ingest = (products: Array<{ id?: string; pma?: number | string | null }>) => {
    for (const p of products) {
      const id = String(p.id ?? "");
      const pma = Number(p.pma);
      if (id && Number.isFinite(pma) && pma > 0) {
        pmaByProductId.set(id, Math.round(pma * 100) / 100);
      }
    }
  };

  if (userId && productIds.length > PRODUCT_BULK_THRESHOLD) {
    const { rows, error } = await fetchAllViaRange<{ id: string; pma: number | string | null }>(
      (from, to) =>
        supabase.from("products").select("id, pma").eq("user_id", userId).range(from, to)
    );
    if (error) {
      console.warn("[pricing] attachProductPma products (bulk)", error);
    } else {
      ingest(rows);
    }
    return pmaByProductId;
  }

  for (let i = 0; i < productIds.length; i += PRODUCT_IN_BATCH) {
    const chunk = productIds.slice(i, i + PRODUCT_IN_BATCH);
    const { data: products, error } = await supabase
      .from("products")
      .select("id, pma")
      .in("id", chunk);
    if (error) {
      console.warn("[pricing] attachProductPma products", error);
      continue;
    }
    ingest(products ?? []);
  }

  return pmaByProductId;
}

/** Anexa `products.pma` via `product_id` já presente na linha (ex.: pricing_cache). */
export async function attachProductPmaToRows<T extends { product_id: string | null }>(
  supabase: SupabaseClient,
  rows: T[],
  options?: { userId?: string }
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

  const pmaByProductId =
    productIds.length > 0
      ? await loadPmaByProductId(supabase, productIds, options?.userId)
      : new Map<string, number>();

  return rows.map((row) => {
    const pid = row.product_id != null ? String(row.product_id) : "";
    return {
      ...row,
      pma: pid ? pmaByProductId.get(pid) ?? null : null,
    };
  });
}
