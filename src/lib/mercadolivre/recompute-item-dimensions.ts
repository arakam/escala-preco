/**
 * Recalcula weight_kg e medidas em ml_items a partir do raw_json (sync anterior).
 * Atualiza products.weight dos produtos vinculados quando o peso do anúncio mudar.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { extractItemDimensions } from "@/lib/mercadolivre/item-dimensions";
import type { MLItemDetail } from "@/lib/mercadolivre/client";

const PAGE_SIZE = 200;

function numChanged(a: number | null | undefined, b: number | null | undefined): boolean {
  const na = a != null && Number.isFinite(Number(a)) ? Number(a) : null;
  const nb = b != null && Number.isFinite(Number(b)) ? Number(b) : null;
  if (na == null && nb == null) return false;
  if (na == null || nb == null) return true;
  return Math.abs(na - nb) > 0.0001;
}

export type RecomputeItemDimensionsResult = {
  ok: true;
  items_scanned: number;
  items_updated: number;
  products_weight_updated: number;
};

export async function recomputeItemDimensionsFromRawJson(options?: {
  accountId?: string;
  dryRun?: boolean;
}): Promise<RecomputeItemDimensionsResult | { ok: false; error: string }> {
  const supabase = createServiceClient();
  const dryRun = options?.dryRun === true;
  let offset = 0;
  let items_scanned = 0;
  let items_updated = 0;
  let products_weight_updated = 0;

  for (;;) {
    let q = supabase
      .from("ml_items")
      .select(
        "id, item_id, account_id, product_id, weight_kg, height_cm, width_cm, length_cm, raw_json"
      )
      .not("raw_json", "is", null)
      .order("item_id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (options?.accountId) {
      q = q.eq("account_id", options.accountId);
    }

    const { data, error } = await q;
    if (error) {
      console.error("[recompute-item-dimensions] select:", error);
      return { ok: false, error: "Erro ao ler anúncios" };
    }

    const batch = data ?? [];
    if (batch.length === 0) break;

    for (const row of batch) {
      items_scanned++;
      if (!row.raw_json || typeof row.raw_json !== "object") continue;

      const dims = extractItemDimensions(row.raw_json as MLItemDetail);
      const patch: Record<string, number | null> = {};
      if (numChanged(row.weight_kg as number | null, dims.weight_kg)) patch.weight_kg = dims.weight_kg;
      if (numChanged(row.height_cm as number | null, dims.height_cm)) patch.height_cm = dims.height_cm;
      if (numChanged(row.width_cm as number | null, dims.width_cm)) patch.width_cm = dims.width_cm;
      if (numChanged(row.length_cm as number | null, dims.length_cm)) patch.length_cm = dims.length_cm;

      if (Object.keys(patch).length === 0) continue;

      if (!dryRun) {
        const { error: upErr } = await supabase.from("ml_items").update(patch).eq("id", row.id);
        if (upErr) {
          console.warn("[recompute-item-dimensions] update item", row.item_id, upErr);
          continue;
        }
        items_updated++;

        if (
          row.product_id &&
          patch.weight_kg != null &&
          numChanged(row.weight_kg as number | null, patch.weight_kg)
        ) {
          const { error: pErr } = await supabase
            .from("products")
            .update({ weight: patch.weight_kg, updated_at: new Date().toISOString() })
            .eq("id", row.product_id);
          if (!pErr) products_weight_updated++;
          else console.warn("[recompute-item-dimensions] update product", row.item_id, pErr);
        }
      } else {
        items_updated++;
      }
    }

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { ok: true, items_scanned, items_updated, products_weight_updated };
}
