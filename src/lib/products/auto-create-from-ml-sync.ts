/**
 * Após sync de anúncios: cria produtos faltantes e atualiza peso/medidas quando o ML informar
 * SKU + altura + largura + comprimento + peso. Em seguida vincula MLB via link_ml_items_to_products.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { extractVariationDimensions } from "@/lib/mercadolivre/item-dimensions";
import type { MLVariationDetail } from "@/lib/mercadolivre/client";
import { extractSkuFromMlListing, normalizeMlSku } from "@/lib/products/ml-sku";

const PAGE_SIZE = 1000;

export type AutoCreateProductsFromMlResult =
  | {
      ok: true;
      skipped_disabled: boolean;
      products_created: number;
      products_updated: number;
      items_linked: number;
      variations_linked: number;
    }
  | { ok: false; error: string };

type CatalogCandidate = {
  sku: string;
  title: string;
  height: number;
  width: number;
  length: number;
  weight: number;
};

function positiveNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function candidateFromItemRow(row: {
  title: string | null;
  seller_custom_field: string | null;
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  raw_json: unknown;
}): CatalogCandidate | null {
  const sku = extractSkuFromMlListing({
    rawJson: row.raw_json,
    sellerCustomField: row.seller_custom_field,
  });
  const weight = positiveNum(row.weight_kg);
  const height = positiveNum(row.height_cm);
  const width = positiveNum(row.width_cm);
  const length = positiveNum(row.length_cm);
  if (!sku || weight == null || height == null || width == null || length == null) return null;
  return {
    sku,
    title: (row.title ?? sku).trim() || sku,
    height,
    width,
    length,
    weight,
  };
}

function candidateFromVariationRow(row: {
  raw_json: unknown;
  seller_custom_field: string | null;
  item_title: string | null;
}): CatalogCandidate | null {
  const sku = extractSkuFromMlListing({
    rawJson: row.raw_json,
    sellerCustomField: row.seller_custom_field,
  });
  if (!sku) return null;
  const dims = extractVariationDimensions(row.raw_json as MLVariationDetail);
  const weight = positiveNum(dims.weight_kg);
  const height = positiveNum(dims.height_cm);
  const width = positiveNum(dims.width_cm);
  const length = positiveNum(dims.length_cm);
  if (weight == null || height == null || width == null || length == null) return null;
  return {
    sku,
    title: (row.item_title ?? sku).trim() || sku,
    height,
    width,
    length,
    weight,
  };
}

/**
 * @param accountId conta ML
 * @param itemIds se informado, processa só esses MLB (sync unitário)
 */
export async function autoCreateProductsFromMlSync(
  accountId: string,
  itemIds?: string[]
): Promise<AutoCreateProductsFromMlResult> {
  const supabase = createServiceClient();

  const { data: account, error: accErr } = await supabase
    .from("ml_accounts")
    .select("id, user_id, auto_create_products_on_sync")
    .eq("id", accountId)
    .single();

  if (accErr || !account) {
    return { ok: false, error: "Conta não encontrada" };
  }

  if (!account.auto_create_products_on_sync) {
    return {
      ok: true,
      skipped_disabled: true,
      products_created: 0,
      products_updated: 0,
      items_linked: 0,
      variations_linked: 0,
    };
  }

  const userId = account.user_id as string;
  const filterIds =
    itemIds?.map((id) => String(id).trim().toUpperCase()).filter((id) => id.length > 0) ?? null;

  const bySku = new Map<string, CatalogCandidate>();
  const titleByItemId = new Map<string, string | null>();

  let offset = 0;
  for (;;) {
    let q = supabase
      .from("ml_items")
      .select("item_id, title, seller_custom_field, weight_kg, height_cm, width_cm, length_cm, raw_json")
      .eq("account_id", accountId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (filterIds?.length) q = q.in("item_id", filterIds);

    const { data, error } = await q;
    if (error) {
      console.error("[auto-create-products] ml_items:", error);
      return { ok: false, error: "Erro ao ler anúncios" };
    }
    const batch = data ?? [];
    for (const row of batch) {
      titleByItemId.set(row.item_id as string, (row.title as string | null) ?? null);
      const c = candidateFromItemRow(row);
      if (c && !bySku.has(c.sku)) bySku.set(c.sku, c);
    }
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  offset = 0;
  for (;;) {
    let q = supabase
      .from("ml_variations")
      .select("item_id, seller_custom_field, raw_json")
      .eq("account_id", accountId)
      .order("updated_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (filterIds?.length) q = q.in("item_id", filterIds);

    const { data, error } = await q;
    if (error) {
      console.error("[auto-create-products] ml_variations:", error);
      return { ok: false, error: "Erro ao ler variações" };
    }
    const batch = data ?? [];
    for (const row of batch) {
      const itemId = row.item_id as string;
      const c = candidateFromVariationRow({
        raw_json: row.raw_json,
        seller_custom_field: (row.seller_custom_field as string | null) ?? null,
        item_title: titleByItemId.get(itemId) ?? null,
      });
      if (c && !bySku.has(c.sku)) bySku.set(c.sku, c);
    }
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (bySku.size === 0) {
    const link = await linkProducts(supabase, userId);
    if (!link.ok) return link;
    return {
      ok: true,
      skipped_disabled: false,
      products_created: 0,
      products_updated: 0,
      items_linked: link.items_linked,
      variations_linked: link.variations_linked,
    };
  }

  const skus = Array.from(bySku.keys());
  const existingBySku = new Map<string, string>();

  const skuSet = new Set(skus);
  const { data: existingRows, error: exErr } = await supabase
    .from("products")
    .select("id, sku")
    .eq("user_id", userId);
  if (exErr) {
    console.error("[auto-create-products] products lookup:", exErr);
    return { ok: false, error: "Erro ao consultar produtos" };
  }
  for (const p of existingRows ?? []) {
    const n = normalizeMlSku(String(p.sku));
    if (skuSet.has(n)) existingBySku.set(n, p.id as string);
  }

  let products_created = 0;
  let products_updated = 0;
  const now = new Date().toISOString();

  const toInsert: Array<Record<string, unknown>> = [];
  for (const [sku, c] of Array.from(bySku.entries())) {
    const existingId = existingBySku.get(sku);
    if (existingId) {
      const { error: upErr } = await supabase
        .from("products")
        .update({
          height: c.height,
          width: c.width,
          length: c.length,
          weight: c.weight,
          updated_at: now,
        })
        .eq("id", existingId)
        .eq("user_id", userId);
      if (!upErr) products_updated++;
      else console.warn("[auto-create-products] update product", sku, upErr);
      continue;
    }
    toInsert.push({
      user_id: userId,
      sku,
      title: c.title,
      height: c.height,
      width: c.width,
      length: c.length,
      weight: c.weight,
    });
  }

  for (let i = 0; i < toInsert.length; i += 100) {
    const chunk = toInsert.slice(i, i + 100);
    const { error: insErr } = await supabase.from("products").insert(chunk);
    if (insErr) {
      console.error("[auto-create-products] insert:", insErr);
      return { ok: false, error: "Erro ao criar produtos" };
    }
    products_created += chunk.length;
  }

  const link = await linkProducts(supabase, userId);
  if (!link.ok) return link;

  return {
    ok: true,
    skipped_disabled: false,
    products_created,
    products_updated,
    items_linked: link.items_linked,
    variations_linked: link.variations_linked,
  };
}

async function linkProducts(
  supabase: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<
  | { ok: true; items_linked: number; variations_linked: number }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc("link_ml_items_to_products", {
    p_user_id: userId,
  });
  if (error) {
    console.error("[auto-create-products] link_ml_items_to_products:", error);
    return { ok: false, error: "Erro ao vincular produtos aos anúncios" };
  }
  const row = (data?.[0] ?? {}) as { items_linked?: number; variations_linked?: number };
  return {
    ok: true,
    items_linked: Number(row.items_linked) || 0,
    variations_linked: Number(row.variations_linked) || 0,
  };
}
