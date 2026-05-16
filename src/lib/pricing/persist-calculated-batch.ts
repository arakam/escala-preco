import type { SupabaseClient } from "@supabase/supabase-js";

export type CalculatedPersistRow = {
  item_id: string;
  variation_id: number | null;
  price: number;
  fee: number;
  shipping_cost: number;
};

const DEFAULT_CHUNK = 50;

/**
 * Grava calculated_* no pricing_cache em paralelo por blocos (evita N awaits sequenciais).
 */
export async function persistCalculatedPricingBatch(
  supabase: SupabaseClient,
  accountId: string,
  rows: CalculatedPersistRow[],
  chunkSize = DEFAULT_CHUNK
): Promise<void> {
  if (rows.length === 0) return;

  const now = new Date().toISOString();
  const size = Math.max(1, Math.min(chunkSize, 200));

  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    await Promise.all(
      chunk.map((item) => {
        const variationId = item.variation_id ?? -1;
        return supabase
          .from("pricing_cache")
          .update({
            calculated_price: item.price,
            calculated_fee: item.fee,
            calculated_shipping_cost: item.shipping_cost,
            calculated_at: now,
          })
          .eq("account_id", accountId)
          .eq("item_id", item.item_id)
          .eq("variation_id", variationId);
      })
    );
  }
}
