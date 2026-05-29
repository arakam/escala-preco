/**
 * Mantém `pricing_cache` alinhado após mudanças em produtos ou vínculos MLB↔SKU.
 * A tela de Preços lê o cache, não a tabela `products` em tempo real.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const PRODUCT_ID_CHUNK = 100;

type MlItemRef = { account_id: string; item_id: string };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function collectLinkedMlItemsForProducts(
  supabase: SupabaseClient,
  productIds: string[]
): Promise<MlItemRef[]> {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const seen = new Map<string, MlItemRef>();

  for (const ids of chunk(uniqueIds, PRODUCT_ID_CHUNK)) {
    const [{ data: linkedItems }, { data: linkedVars }] = await Promise.all([
      supabase.from("ml_items").select("account_id, item_id").in("product_id", ids),
      supabase.from("ml_variations").select("account_id, item_id").in("product_id", ids),
    ]);

    for (const r of [...(linkedItems ?? []), ...(linkedVars ?? [])]) {
      const account_id = r.account_id != null ? String(r.account_id) : "";
      const item_id = r.item_id != null ? String(r.item_id).trim().toUpperCase() : "";
      if (!account_id || !item_id) continue;
      const key = `${account_id}:${item_id}`;
      if (!seen.has(key)) seen.set(key, { account_id, item_id });
    }
  }

  return Array.from(seen.values());
}

async function clearPromotionsSnapshotForItemIds(
  supabase: SupabaseClient,
  userId: string,
  itemIds: string[]
): Promise<void> {
  const unique = Array.from(new Set(itemIds.map((id) => id.trim().toUpperCase()).filter(Boolean)));
  if (unique.length === 0) return;

  for (const ids of chunk(unique, 200)) {
    const { error } = await supabase
      .from("promotions_cache_rows")
      .delete()
      .eq("user_id", userId)
      .in("item_id", ids);
    if (error) {
      console.error("[refresh-pricing-after-product] limpar snapshot promoções:", error);
    }
  }
}

/** Recalcula `pricing_cache` para cada MLB vinculado aos produtos informados. */
export async function refreshPricingCacheForProductIds(
  supabase: SupabaseClient,
  userId: string,
  productIds: string[],
  options?: { clearPromotionsSnapshot?: boolean }
): Promise<{ refreshed: number; errors: string[] }> {
  const pairs = await collectLinkedMlItemsForProducts(supabase, productIds);
  if (pairs.length === 0) return { refreshed: 0, errors: [] };

  const { refreshPricingCacheByItemId } = await import("@/lib/pricing-cache");
  const errors: string[] = [];

  for (const { account_id, item_id } of pairs) {
    try {
      const result = await refreshPricingCacheByItemId(account_id, item_id);
      if (!result.ok) errors.push(`${item_id}: ${result.error}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${item_id}: ${msg}`);
    }
  }

  if (options?.clearPromotionsSnapshot !== false) {
    await clearPromotionsSnapshotForItemIds(
      supabase,
      userId,
      pairs.map((p) => p.item_id)
    );
  }

  return { refreshed: pairs.length, errors };
}

/** Recalcula todo o `pricing_cache` da conta ML do usuário. */
export async function refreshPricingCacheForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!account?.id) return { ok: true, count: 0 };

  try {
    const { refreshPricingCache } = await import("@/lib/pricing-cache");
    const refreshed = await refreshPricingCache(account.id);
    return refreshed.ok
      ? { ok: true, count: refreshed.count }
      : { ok: false, error: refreshed.error };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[refresh-pricing-after-product] refresh conta:", msg);
    return { ok: false, error: msg || "Erro ao atualizar cache de preços" };
  }
}

export type LinkMlProductsResult = {
  items_linked: number;
  variations_linked: number;
  total_linked: number;
};

/** Vincula anúncios/variações ao produto pelo SKU (RPC). */
export async function linkMlItemsToProducts(
  supabase: SupabaseClient,
  userId: string
): Promise<LinkMlProductsResult> {
  const { data, error } = await supabase.rpc("link_ml_items_to_products", {
    p_user_id: userId,
  });

  if (error) {
    console.error("[refresh-pricing-after-product] link_ml_items_to_products:", error);
    throw error;
  }

  const row = (data?.[0] ?? {}) as { items_linked?: number; variations_linked?: number };
  const items_linked = Number(row.items_linked) || 0;
  const variations_linked = Number(row.variations_linked) || 0;
  return {
    items_linked,
    variations_linked,
    total_linked: items_linked + variations_linked,
  };
}

/**
 * Após importação ou alteração em massa: re-vincula por SKU e atualiza o cache de preços.
 * Usa refresh completo da conta (importações costumam afetar muitos SKUs).
 */
export async function linkMlItemsAndRefreshPricingCacheForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  link: LinkMlProductsResult;
  cache: { ok: boolean; count?: number; error?: string };
}> {
  const link = await linkMlItemsToProducts(supabase, userId);
  const cache = await refreshPricingCacheForUser(supabase, userId);
  return { link, cache };
}

/** Atualiza cache para MLB(s) específicos (ex.: após sync unitário ou recomputar dimensões). */
export async function refreshPricingCacheForMlItems(
  pairs: MlItemRef[]
): Promise<{ refreshed: number; errors: string[] }> {
  const seen = new Map<string, MlItemRef>();
  for (const p of pairs) {
    const account_id = p.account_id != null ? String(p.account_id) : "";
    const item_id = p.item_id != null ? String(p.item_id).trim().toUpperCase() : "";
    if (!account_id || !item_id) continue;
    seen.set(`${account_id}:${item_id}`, { account_id, item_id });
  }
  if (seen.size === 0) return { refreshed: 0, errors: [] };

  const { refreshPricingCacheByItemId } = await import("@/lib/pricing-cache");
  const errors: string[] = [];
  for (const { account_id, item_id } of Array.from(seen.values())) {
    try {
      const result = await refreshPricingCacheByItemId(account_id, item_id);
      if (!result.ok) errors.push(`${item_id}: ${result.error}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${item_id}: ${msg}`);
    }
  }
  return { refreshed: seen.size, errors };
}
