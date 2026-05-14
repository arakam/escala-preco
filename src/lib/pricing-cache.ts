/**
 * Atualiza o cache da tela de preços (pricing_cache) para uma conta.
 * Junta ml_items, ml_variations, products, planned_prices e vendas 30d em uma única tabela
 * para leitura rápida com filtros.
 *
 * Anúncios clássicos com variações: uma linha por MLB (preço nível anúncio; o ML ainda não
 * permite preço por variação fora do fluxo User Product). Variações alimentam só o fallback
 * de preço planejado legado (chaves por variation_id).
 *
 * Chamado após: sync de anúncios, vínculo MLB-SKU, ou manualmente (POST /api/pricing/cache/refresh).
 */
import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchSellerPromotionsForItem, runWithConcurrency } from "@/lib/mercadolivre/client";
import { buildMlActivePromotionsStorageText } from "@/lib/mercadolivre/seller-promotions-item";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { getSalesMap } from "@/lib/mercadolivre/sales";

const VARIATION_ID_ITEM = -1;

/** Gera UUID determinístico por (account_id, item_id, variation_id) para evitar colisão entre ml_items.id e ml_variations.id. */
function cacheRowId(accountId: string, itemId: string, variationId: number): string {
  const raw = `${accountId}:${itemId}:${variationId}`;
  const hex = createHash("sha256").update(raw).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
const PAGE_SIZE = 1000;
const INSERT_BATCH = 500;

function extractSku(rawJson: Record<string, unknown> | null, productSku: string | null): string | null {
  if (!rawJson) return productSku ?? null;
  const attrs = rawJson.attributes as Array<{ id?: string; value_name?: string }> | undefined;
  if (Array.isArray(attrs)) {
    const skuAttr = attrs.find((a) => a.id === "SELLER_SKU");
    if (skuAttr?.value_name) return skuAttr.value_name;
  }
  if (typeof rawJson.seller_custom_field === "string" && rawJson.seller_custom_field.trim())
    return rawJson.seller_custom_field.trim();
  return productSku ?? null;
}

function resolvePlannedPriceForParentListing(
  plannedByKey: Map<string, number>,
  itemId: string,
  fallbackPrice: number,
  variationIds: number[]
): number {
  const main = plannedByKey.get(`${itemId}:${VARIATION_ID_ITEM}`);
  if (main !== undefined) return main;
  for (const vid of variationIds) {
    const p = plannedByKey.get(`${itemId}:${vid}`);
    if (p !== undefined) return p;
  }
  return fallbackPrice;
}

function pickSavedCalculatedForParentListing<
  T extends { calculated_price: number; calculated_fee: number; calculated_shipping_cost: number; calculated_at: string },
>(
  oldCalculated: Map<string, T>,
  itemId: string,
  variationIds: number[]
): T | undefined {
  const keys = [`${itemId}:${VARIATION_ID_ITEM}`, ...variationIds.map((v) => `${itemId}:${v}`)];
  for (const k of keys) {
    const s = oldCalculated.get(k);
    if (s) return s;
  }
  return undefined;
}

/** Campos de produto para a linha consolidada do MLB (pai + variações). */
interface MergedListingProductFields {
  product_id: string | null;
  sku: string | null;
  cost_price: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
}

/**
 * MLB com variações costuma não ter product_id/SKU no pai; vínculos ficam em ml_variations.
 * Se o pai já tem produto, usa o pai; senão deriva das variações (menor variation_id com produto).
 * Vários produtos distintos: usa o primeiro para custo/dimensões/impostos (indicativo); SKU pode listar vários.
 */
function mergeParentListingProductFields(
  parentRaw: Record<string, unknown>,
  variationRows: Record<string, unknown>[],
  toNum: (v: unknown) => number | null
): MergedListingProductFields {
  const parentPid = parentRaw.product_id != null && parentRaw.product_id !== "" ? String(parentRaw.product_id) : null;
  if (parentPid) {
    const prod = parentRaw.products as Record<string, unknown> | Record<string, unknown>[] | null;
    const p = Array.isArray(prod) ? prod[0] : prod;
    const productSku = p && typeof p.sku === "string" ? p.sku : null;
    const sku = extractSku((parentRaw.raw_json as Record<string, unknown>) || null, productSku);
    return {
      product_id: parentPid,
      sku,
      cost_price: toNum(p?.cost_price),
      weight_kg: toNum(p?.weight),
      height_cm: toNum(p?.height),
      width_cm: toNum(p?.width),
      length_cm: toNum(p?.length),
      tax_percent: toNum(p?.tax_percent),
      extra_fee_percent: toNum(p?.extra_fee_percent),
      fixed_expenses: toNum(p?.fixed_expenses),
    };
  }

  if (variationRows.length === 0) {
    return {
      product_id: null,
      sku: extractSku((parentRaw.raw_json as Record<string, unknown>) || null, null),
      cost_price: null,
      weight_kg: null,
      height_cm: null,
      width_cm: null,
      length_cm: null,
      tax_percent: null,
      extra_fee_percent: null,
      fixed_expenses: null,
    };
  }

  const snapshots = variationRows
    .map((raw) => {
      const prod = raw.products as Record<string, unknown> | Record<string, unknown>[] | null;
      const p = Array.isArray(prod) ? prod[0] : prod;
      const productSku = p && typeof p.sku === "string" ? p.sku : null;
      const sku = extractSku((raw.raw_json as Record<string, unknown>) || null, productSku);
      const pid = raw.product_id != null && raw.product_id !== "" ? String(raw.product_id) : null;
      return {
        variation_id: Number(raw.variation_id),
        product_id: pid,
        sku,
        cost_price: toNum(p?.cost_price),
        weight_kg: toNum(p?.weight),
        height_cm: toNum(p?.height),
        width_cm: toNum(p?.width),
        length_cm: toNum(p?.length),
        tax_percent: toNum(p?.tax_percent),
        extra_fee_percent: toNum(p?.extra_fee_percent),
        fixed_expenses: toNum(p?.fixed_expenses),
      };
    })
    .sort((a, b) => a.variation_id - b.variation_id);

  const withProd = snapshots.filter((s) => s.product_id != null);
  const skusAll = Array.from(
    new Set(snapshots.map((s) => s.sku).filter((x): x is string => Boolean(x)))
  );

  if (withProd.length === 0) {
    const skuLabel =
      skusAll.length === 0
        ? null
        : skusAll.length === 1
          ? skusAll[0]
          : `${skusAll[0]} (+${skusAll.length - 1} SKUs)`;
    return {
      product_id: null,
      sku: skuLabel,
      cost_price: null,
      weight_kg: null,
      height_cm: null,
      width_cm: null,
      length_cm: null,
      tax_percent: null,
      extra_fee_percent: null,
      fixed_expenses: null,
    };
  }

  const base = withProd[0];
  const uniquePids = Array.from(new Set(withProd.map((s) => s.product_id!)));

  let skuOut: string | null;
  if (uniquePids.length === 1) {
    skuOut = skusAll.length <= 1 ? base.sku : skusAll.join(" · ");
  } else {
    skuOut =
      skusAll.length <= 2 ? skusAll.join(" · ") : `${skusAll[0]} · … (+${skusAll.length - 1} SKUs)`;
  }

  return {
    product_id: base.product_id,
    sku: skuOut,
    cost_price: base.cost_price,
    weight_kg: base.weight_kg,
    height_cm: base.height_cm,
    width_cm: base.width_cm,
    length_cm: base.length_cm,
    tax_percent: base.tax_percent,
    extra_fee_percent: base.extra_fee_percent,
    fixed_expenses: base.fixed_expenses,
  };
}

export interface PricingCacheRow {
  id: string;
  account_id: string;
  item_id: string;
  variation_id: number;
  title: string | null;
  thumbnail: string | null;
  permalink: string | null;
  status: string | null;
  listing_type_id: string | null;
  category_id: string | null;
  current_price: number;
  sku: string | null;
  product_id: string | null;
  cost_price: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  planned_price: number;
  sales_30d: number;
  orders_30d: number;
  /** Uma linha por promoção ativa (API seller-promotions/items); vazio se não houver. */
  ml_active_promotions: string;
  sort_title: string;
  cache_updated_at: string;
  /** % taxa ML (fee/preço) da tabela ml_category_fee_reference para categoria+tipo */
  reference_fee_percent: number | null;
}

export async function refreshPricingCache(accountId: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const supabase = createServiceClient();

  const { data: account, error: accountErr } = await supabase
    .from("ml_accounts")
    .select("id, ml_user_id, site_id")
    .eq("id", accountId)
    .single();

  if (accountErr || !account) {
    return { ok: false, error: "Conta não encontrada" };
  }

  const now = new Date().toISOString();

  const siteId = ((account as { site_id?: string | null }).site_id ?? "MLB").trim() || "MLB";
  const feeRefByCatType = new Map<string, number>();
  const { data: feeRefRows } = await supabase
    .from("ml_category_fee_reference")
    .select("category_id, listing_type_id, fee_percent")
    .eq("site_id", siteId);
  for (const fr of feeRefRows ?? []) {
    feeRefByCatType.set(`${fr.category_id}:${fr.listing_type_id}`, Number(fr.fee_percent));
  }

  const referenceFeePercent = (categoryId: unknown, listingTypeId: unknown): number | null => {
    const c = categoryId != null && categoryId !== "" ? String(categoryId) : null;
    const l = listingTypeId != null && listingTypeId !== "" ? String(listingTypeId) : null;
    if (!c || !l) return null;
    const v = feeRefByCatType.get(`${c}:${l}`);
    return v != null && Number.isFinite(v) ? v : null;
  };

  const itemsSelect = `
    id, account_id, item_id, title, thumbnail, permalink, status, listing_type_id, category_id, price, raw_json, product_id,
    products:product_id (sku, cost_price, weight, height, width, length, tax_percent, extra_fee_percent, fixed_expenses)
  `;
  const variationsSelect = `
    id, account_id, item_id, variation_id, price, raw_json, product_id,
    products:product_id (sku, cost_price, weight, height, width, length, tax_percent, extra_fee_percent, fixed_expenses)
  `;

  // 1) Itens sem variações (paginar: Supabase retorna no máx 1000 por request)
  const items: unknown[] = [];
  let itemsFrom = 0;
  while (true) {
    const { data: chunk, error: itemsErr } = await supabase
      .from("ml_items")
      .select(itemsSelect)
      .eq("account_id", accountId)
      .eq("has_variations", false)
      .range(itemsFrom, itemsFrom + PAGE_SIZE - 1);
    if (itemsErr) {
      console.error("[pricing-cache] ml_items error:", itemsErr);
      return { ok: false, error: "Erro ao carregar anúncios" };
    }
    const list = (chunk || []) as unknown[];
    items.push(...list);
    if (list.length < PAGE_SIZE) break;
    itemsFrom += PAGE_SIZE;
  }

  // 2) Variações (paginar)
  const variations: unknown[] = [];
  let variationsFrom = 0;
  while (true) {
    const { data: chunk, error: variationsErr } = await supabase
      .from("ml_variations")
      .select(variationsSelect)
      .eq("account_id", accountId)
      .range(variationsFrom, variationsFrom + PAGE_SIZE - 1);
    if (variationsErr) {
      console.error("[pricing-cache] ml_variations error:", variationsErr);
      return { ok: false, error: "Erro ao carregar variações" };
    }
    const list = (chunk || []) as unknown[];
    variations.push(...list);
    if (list.length < PAGE_SIZE) break;
    variationsFrom += PAGE_SIZE;
  }

  const variationRowsByItemId = new Map<string, Record<string, unknown>[]>();
  const variationIdsByItemId = new Map<string, number[]>();
  for (const v of variations as Record<string, unknown>[]) {
    const iid = v.item_id as string;
    const vid = Number(v.variation_id);
    const arrRows = variationRowsByItemId.get(iid);
    if (arrRows) arrRows.push(v);
    else variationRowsByItemId.set(iid, [v]);
    const arrIds = variationIdsByItemId.get(iid);
    if (arrIds) arrIds.push(vid);
    else variationIdsByItemId.set(iid, [vid]);
  }

  // 2b) Anúncios pai com variações (uma linha de cache por MLB)
  const itemsWithVariations: unknown[] = [];
  let ivFrom = 0;
  while (true) {
    const { data: chunk, error: ivErr } = await supabase
      .from("ml_items")
      .select(itemsSelect)
      .eq("account_id", accountId)
      .eq("has_variations", true)
      .range(ivFrom, ivFrom + PAGE_SIZE - 1);
    if (ivErr) {
      console.error("[pricing-cache] ml_items (com variações) error:", ivErr);
      return { ok: false, error: "Erro ao carregar anúncios com variações" };
    }
    const list = (chunk || []) as unknown[];
    itemsWithVariations.push(...list);
    if (list.length < PAGE_SIZE) break;
    ivFrom += PAGE_SIZE;
  }

  // 3) Preços planejados (paginar se houver muitos)
  const plannedRows: Array<{ item_id: string; variation_id: number | null; planned_price: number }> = [];
  let plannedFrom = 0;
  while (true) {
    const { data: chunk, error: plannedErr } = await supabase
      .from("planned_prices")
      .select("item_id, variation_id, planned_price")
      .eq("account_id", accountId)
      .range(plannedFrom, plannedFrom + PAGE_SIZE - 1);
    if (plannedErr) {
      console.error("[pricing-cache] planned_prices error:", plannedErr);
      return { ok: false, error: "Erro ao carregar preços planejados" };
    }
    const list = (chunk || []) as Array<{ item_id: string; variation_id: number | null; planned_price: number }>;
    plannedRows.push(...list);
    if (list.length < PAGE_SIZE) break;
    plannedFrom += PAGE_SIZE;
  }

  const plannedByKey = new Map<string, number>();
  for (const r of plannedRows) {
    const vid = r.variation_id == null || r.variation_id === -1 ? VARIATION_ID_ITEM : Number(r.variation_id);
    plannedByKey.set(`${r.item_id}:${vid}`, Number(r.planned_price));
  }

  // 4) Vendas 30d (API ML)
  const allItemIds = Array.from(
    new Set([
      ...(items as Array<{ item_id: string }>).map((i) => i.item_id),
      ...(itemsWithVariations as Array<{ item_id: string }>).map((i) => i.item_id),
      ...(variations as Array<{ item_id: string }>).map((v) => v.item_id),
    ])
  );

  let salesMap: Record<string, number> = {};
  let ordersMap: Record<string, number> = {};
  let accessToken: string | null = null;
  if (allItemIds.length > 0) {
    const { data: tokenData } = await supabase
      .from("ml_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("account_id", accountId)
      .single();
    const token = tokenData as { access_token: string; refresh_token: string; expires_at: string } | null;
    if (token) {
      accessToken =
        (await getValidAccessToken(
          accountId,
          token.access_token,
          token.refresh_token,
          token.expires_at,
          supabase
        )) ?? null;
      if (accessToken) {
        const to = new Date();
        const from = new Date(to);
        from.setDate(from.getDate() - 30);
        const dateFrom = from.toISOString().replace(/\.\d{3}Z/, ".000Z");
        const dateTo = to.toISOString().replace(/\.\d{3}Z/, ".999Z");
        const maps = await getSalesMap(
          accessToken,
          account.ml_user_id as number,
          allItemIds,
          dateFrom,
          dateTo
        );
        salesMap = maps.sales;
        ordersMap = maps.orders;
      }
    }
  }

  const promoByItemId = new Map<string, string>();
  if (accessToken && allItemIds.length > 0) {
    await runWithConcurrency(allItemIds, 4, async (itemId) => {
      const key = String(itemId).trim().toUpperCase();
      try {
        const raw = await fetchSellerPromotionsForItem(key, accessToken!);
        promoByItemId.set(key, buildMlActivePromotionsStorageText(raw));
      } catch (e) {
        console.warn("[pricing-cache] seller-promotions", itemId, e);
        promoByItemId.set(key, "");
      }
    });
  }

  const mlPromoFor = (itemId: string) =>
    promoByItemId.get(String(itemId).trim().toUpperCase()) ?? "";

  // 5) Montar linhas do cache
  const rows: PricingCacheRow[] = [];

  const toNum = (v: unknown): number | null =>
    v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null;

  for (const item of items) {
    const raw = item as unknown as Record<string, unknown>;
    const prod = raw.products as Record<string, unknown> | Record<string, unknown>[] | null;
    const p = Array.isArray(prod) ? prod[0] : prod;
    const productSku = p && typeof p.sku === "string" ? p.sku : null;
    const sku = extractSku((raw.raw_json as Record<string, unknown>) || null, productSku);
    const currentPrice = Number(raw.price) || 0;
    const key = `${raw.item_id}:${VARIATION_ID_ITEM}`;
    const plannedPrice = plannedByKey.get(key) ?? currentPrice;
    const title = (raw.title as string) ?? null;
    rows.push({
      id: cacheRowId(accountId, raw.item_id as string, VARIATION_ID_ITEM),
      account_id: accountId,
      item_id: raw.item_id as string,
      variation_id: VARIATION_ID_ITEM,
      title,
      thumbnail: (raw.thumbnail as string) ?? null,
      permalink: (raw.permalink as string) ?? null,
      status: (raw.status as string) ?? null,
      listing_type_id: (raw.listing_type_id as string) ?? null,
      category_id: (raw.category_id as string) ?? null,
      current_price: currentPrice,
      sku,
      product_id: (raw.product_id as string) ?? null,
      cost_price: toNum(p?.cost_price),
      weight_kg: toNum(p?.weight),
      height_cm: toNum(p?.height),
      width_cm: toNum(p?.width),
      length_cm: toNum(p?.length),
      tax_percent: toNum(p?.tax_percent),
      extra_fee_percent: toNum(p?.extra_fee_percent),
      fixed_expenses: toNum(p?.fixed_expenses),
      planned_price: plannedPrice,
      sales_30d: salesMap[raw.item_id as string] ?? 0,
      orders_30d: ordersMap[raw.item_id as string] ?? 0,
      ml_active_promotions: mlPromoFor(raw.item_id as string),
      sort_title: (title || "").toLowerCase(),
      cache_updated_at: now,
      reference_fee_percent: referenceFeePercent(raw.category_id, raw.listing_type_id),
    });
  }

  for (const item of itemsWithVariations) {
    const raw = item as unknown as Record<string, unknown>;
    const currentPrice = Number(raw.price) || 0;
    const itemId = raw.item_id as string;
    const vids = variationIdsByItemId.get(itemId) ?? [];
    const varRows = variationRowsByItemId.get(itemId) ?? [];
    const merged = mergeParentListingProductFields(raw, varRows, toNum);
    const plannedPrice = resolvePlannedPriceForParentListing(plannedByKey, itemId, currentPrice, vids);
    const title = (raw.title as string) ?? null;
    rows.push({
      id: cacheRowId(accountId, itemId, VARIATION_ID_ITEM),
      account_id: accountId,
      item_id: itemId,
      variation_id: VARIATION_ID_ITEM,
      title,
      thumbnail: (raw.thumbnail as string) ?? null,
      permalink: (raw.permalink as string) ?? null,
      status: (raw.status as string) ?? null,
      listing_type_id: (raw.listing_type_id as string) ?? null,
      category_id: (raw.category_id as string) ?? null,
      current_price: currentPrice,
      sku: merged.sku,
      product_id: merged.product_id,
      cost_price: merged.cost_price,
      weight_kg: merged.weight_kg,
      height_cm: merged.height_cm,
      width_cm: merged.width_cm,
      length_cm: merged.length_cm,
      tax_percent: merged.tax_percent,
      extra_fee_percent: merged.extra_fee_percent,
      fixed_expenses: merged.fixed_expenses,
      planned_price: plannedPrice,
      sales_30d: salesMap[itemId] ?? 0,
      orders_30d: ordersMap[itemId] ?? 0,
      ml_active_promotions: mlPromoFor(itemId),
      sort_title: (title || "").toLowerCase(),
      cache_updated_at: now,
      reference_fee_percent: referenceFeePercent(raw.category_id, raw.listing_type_id),
    });
  }

  // Deduplicar por (account_id, item_id, variation_id) — dados de origem podem ter duplicatas
  const rowsById = new Map<string, PricingCacheRow>();
  for (const r of rows) {
    rowsById.set(r.id, r);
  }
  const uniqueRows = Array.from(rowsById.values());

  // Preservar dados calculados antes de limpar o cache (para consulta rápida após refresh)
  const oldCalculated = new Map<
    string,
    { calculated_price: number; calculated_fee: number; calculated_shipping_cost: number; calculated_at: string }
  >();
  const { data: oldRows } = await supabase
    .from("pricing_cache")
    .select("item_id, variation_id, calculated_price, calculated_fee, calculated_shipping_cost, calculated_at")
    .eq("account_id", accountId);
  for (const o of oldRows ?? []) {
    if (
      o.calculated_price != null &&
      o.calculated_fee != null &&
      o.calculated_shipping_cost != null &&
      o.calculated_at != null
    ) {
      const key = `${o.item_id}:${o.variation_id}`;
      oldCalculated.set(key, {
        calculated_price: Number(o.calculated_price),
        calculated_fee: Number(o.calculated_fee),
        calculated_shipping_cost: Number(o.calculated_shipping_cost),
        calculated_at: String(o.calculated_at),
      });
    }
  }

  // 6) Substituir cache da conta (delete + insert para remover itens que saíram do ML)
  const { error: deleteErr } = await supabase.from("pricing_cache").delete().eq("account_id", accountId);
  if (deleteErr) {
    console.error("[pricing-cache] delete error:", deleteErr);
    return { ok: false, error: "Erro ao limpar cache" };
  }

  if (uniqueRows.length === 0) {
    return { ok: true, count: 0 };
  }

  const toInsert = uniqueRows.map((r) => {
    const vids = variationIdsByItemId.get(r.item_id) ?? [];
    const saved = pickSavedCalculatedForParentListing(oldCalculated, r.item_id, vids);
    return {
      id: r.id,
      account_id: r.account_id,
      item_id: r.item_id,
      variation_id: r.variation_id,
      title: r.title,
      thumbnail: r.thumbnail,
      permalink: r.permalink,
      status: r.status,
      listing_type_id: r.listing_type_id,
      category_id: r.category_id,
      current_price: r.current_price,
      sku: r.sku,
      product_id: r.product_id,
      cost_price: r.cost_price,
      weight_kg: r.weight_kg,
      height_cm: r.height_cm,
      width_cm: r.width_cm,
      length_cm: r.length_cm,
      tax_percent: r.tax_percent,
      extra_fee_percent: r.extra_fee_percent,
      fixed_expenses: r.fixed_expenses,
      planned_price: r.planned_price,
      sales_30d: r.sales_30d,
      orders_30d: r.orders_30d,
      ml_active_promotions: r.ml_active_promotions,
      sort_title: r.sort_title,
      cache_updated_at: r.cache_updated_at,
      reference_fee_percent: r.reference_fee_percent,
      ...(saved && {
        calculated_price: saved.calculated_price,
        calculated_fee: saved.calculated_fee,
        calculated_shipping_cost: saved.calculated_shipping_cost,
        calculated_at: saved.calculated_at,
      }),
    };
  });

  for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
    const batch = toInsert.slice(i, i + INSERT_BATCH);
    const { error: insertErr } = await supabase.from("pricing_cache").insert(batch);
    if (insertErr) {
      console.error("[pricing-cache] insert error:", insertErr);
      return { ok: false, error: "Erro ao gravar cache" };
    }
  }

  return { ok: true, count: uniqueRows.length };
}

/**
 * Atualiza no cache apenas as linhas de um item_id (após sync de um item ou clique em "Atualizar este item").
 */
export async function refreshPricingCacheByItemId(
  accountId: string,
  itemId: string
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const supabase = createServiceClient();
  const itemIdClean = itemId.trim().toUpperCase();

  const { data: account, error: accountErr } = await supabase
    .from("ml_accounts")
    .select("id, ml_user_id, site_id")
    .eq("id", accountId)
    .single();
  if (accountErr || !account) return { ok: false, error: "Conta não encontrada" };

  const now = new Date().toISOString();
  const siteId = ((account as { site_id?: string | null }).site_id ?? "MLB").trim() || "MLB";

  const feeRefByCatType = new Map<string, number>();
  const { data: feeRefRowsSingle } = await supabase
    .from("ml_category_fee_reference")
    .select("category_id, listing_type_id, fee_percent")
    .eq("site_id", siteId);
  for (const fr of feeRefRowsSingle ?? []) {
    feeRefByCatType.set(`${fr.category_id}:${fr.listing_type_id}`, Number(fr.fee_percent));
  }
  const referenceFeePercentByItem = (categoryId: unknown, listingTypeId: unknown): number | null => {
    const c = categoryId != null && categoryId !== "" ? String(categoryId) : null;
    const l = listingTypeId != null && listingTypeId !== "" ? String(listingTypeId) : null;
    if (!c || !l) return null;
    const v = feeRefByCatType.get(`${c}:${l}`);
    return v != null && Number.isFinite(v) ? v : null;
  };

  const itemsSelectWithVarFlag = `
    id, account_id, item_id, title, thumbnail, permalink, status, listing_type_id, category_id, price, raw_json, product_id, has_variations,
    products:product_id (sku, cost_price, weight, height, width, length, tax_percent, extra_fee_percent, fixed_expenses)
  `;

  const { data: mlItem } = await supabase
    .from("ml_items")
    .select(itemsSelectWithVarFlag)
    .eq("account_id", accountId)
    .eq("item_id", itemIdClean)
    .maybeSingle();

  const variationsSelectByItem = `
    id, account_id, item_id, variation_id, price, raw_json, product_id,
    products:product_id (sku, cost_price, weight, height, width, length, tax_percent, extra_fee_percent, fixed_expenses)
  `;
  const { data: variationsFull } = await supabase
    .from("ml_variations")
    .select(variationsSelectByItem)
    .eq("account_id", accountId)
    .eq("item_id", itemIdClean);

  const varRowsFull = (variationsFull ?? []) as Record<string, unknown>[];
  const variationIds = varRowsFull.map((r) => Number(r.variation_id)).sort((a, b) => a - b);

  const { data: plannedRows } = await supabase
    .from("planned_prices")
    .select("item_id, variation_id, planned_price")
    .eq("account_id", accountId)
    .eq("item_id", itemIdClean);
  const plannedByKey = new Map<string, number>();
  for (const r of plannedRows || []) {
    const vid = r.variation_id == null || r.variation_id === -1 ? VARIATION_ID_ITEM : Number(r.variation_id);
    plannedByKey.set(`${r.item_id}:${vid}`, Number(r.planned_price));
  }

  let salesMap: Record<string, number> = {};
  let ordersMap: Record<string, number> = {};
  let accessToken: string | null = null;
  const { data: tokenData } = await supabase.from("ml_tokens").select("access_token, refresh_token, expires_at").eq("account_id", accountId).single();
  const token = tokenData as { access_token: string; refresh_token: string; expires_at: string } | null;
  if (token) {
    accessToken =
      (await getValidAccessToken(accountId, token.access_token, token.refresh_token, token.expires_at, supabase)) ??
      null;
    if (accessToken) {
      const to = new Date();
      const from = new Date(to);
      from.setDate(from.getDate() - 30);
      const dateFrom = from.toISOString().replace(/\.\d{3}Z/, ".000Z");
      const dateTo = to.toISOString().replace(/\.\d{3}Z/, ".999Z");
      const maps = await getSalesMap(accessToken, account.ml_user_id as number, [itemIdClean], dateFrom, dateTo);
      salesMap = maps.sales;
      ordersMap = maps.orders;
    }
  }

  let mlPromoText = "";
  if (accessToken) {
    const raw = await fetchSellerPromotionsForItem(itemIdClean, accessToken);
    mlPromoText = buildMlActivePromotionsStorageText(raw);
  }

  const toNum = (v: unknown): number | null => (v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
  const rows: PricingCacheRow[] = [];

  if (mlItem) {
    const raw = mlItem as unknown as Record<string, unknown>;
    const currentPrice = Number(raw.price) || 0;
    const hasVariations = raw.has_variations === true;
    const merged = mergeParentListingProductFields(raw, hasVariations ? varRowsFull : [], toNum);
    const plannedPrice = hasVariations
      ? resolvePlannedPriceForParentListing(plannedByKey, itemIdClean, currentPrice, variationIds)
      : plannedByKey.get(`${itemIdClean}:${VARIATION_ID_ITEM}`) ?? currentPrice;
    const title = (raw.title as string) ?? null;
    rows.push({
      id: cacheRowId(accountId, itemIdClean, VARIATION_ID_ITEM),
      account_id: accountId,
      item_id: itemIdClean,
      variation_id: VARIATION_ID_ITEM,
      title,
      thumbnail: (raw.thumbnail as string) ?? null,
      permalink: (raw.permalink as string) ?? null,
      status: (raw.status as string) ?? null,
      listing_type_id: (raw.listing_type_id as string) ?? null,
      category_id: (raw.category_id as string) ?? null,
      current_price: currentPrice,
      sku: merged.sku,
      product_id: merged.product_id,
      cost_price: merged.cost_price,
      weight_kg: merged.weight_kg,
      height_cm: merged.height_cm,
      width_cm: merged.width_cm,
      length_cm: merged.length_cm,
      tax_percent: merged.tax_percent,
      extra_fee_percent: merged.extra_fee_percent,
      fixed_expenses: merged.fixed_expenses,
      planned_price: plannedPrice,
      sales_30d: salesMap[itemIdClean] ?? 0,
      orders_30d: ordersMap[itemIdClean] ?? 0,
      ml_active_promotions: mlPromoText,
      sort_title: (title || "").toLowerCase(),
      cache_updated_at: now,
      reference_fee_percent: referenceFeePercentByItem(raw.category_id, raw.listing_type_id),
    });
  }

  const rowsById = new Map<string, PricingCacheRow>();
  for (const r of rows) rowsById.set(r.id, r);
  const uniqueRows = Array.from(rowsById.values());

  const oldCalculated = new Map<
    string,
    { calculated_price: number; calculated_fee: number; calculated_shipping_cost: number; calculated_at: string }
  >();
  const { data: oldRows } = await supabase
    .from("pricing_cache")
    .select("item_id, variation_id, calculated_price, calculated_fee, calculated_shipping_cost, calculated_at")
    .eq("account_id", accountId)
    .eq("item_id", itemIdClean);
  for (const o of oldRows ?? []) {
    if (
      o.calculated_price != null &&
      o.calculated_fee != null &&
      o.calculated_shipping_cost != null &&
      o.calculated_at != null
    ) {
      oldCalculated.set(`${o.item_id}:${o.variation_id}`, {
        calculated_price: Number(o.calculated_price),
        calculated_fee: Number(o.calculated_fee),
        calculated_shipping_cost: Number(o.calculated_shipping_cost),
        calculated_at: String(o.calculated_at),
      });
    }
  }

  await supabase.from("pricing_cache").delete().eq("account_id", accountId).eq("item_id", itemIdClean);
  if (uniqueRows.length > 0) {
    const toInsert = uniqueRows.map((r) => {
      const saved = pickSavedCalculatedForParentListing(oldCalculated, r.item_id, variationIds);
      return {
      id: r.id,
      account_id: r.account_id,
      item_id: r.item_id,
      variation_id: r.variation_id,
      title: r.title,
      thumbnail: r.thumbnail,
      permalink: r.permalink,
      status: r.status,
      listing_type_id: r.listing_type_id,
      category_id: r.category_id,
      current_price: r.current_price,
      sku: r.sku,
      product_id: r.product_id,
      cost_price: r.cost_price,
      weight_kg: r.weight_kg,
      height_cm: r.height_cm,
      width_cm: r.width_cm,
      length_cm: r.length_cm,
      tax_percent: r.tax_percent,
      extra_fee_percent: r.extra_fee_percent,
      fixed_expenses: r.fixed_expenses,
      planned_price: r.planned_price,
      sales_30d: r.sales_30d,
      orders_30d: r.orders_30d,
      ml_active_promotions: r.ml_active_promotions,
      sort_title: r.sort_title,
      cache_updated_at: r.cache_updated_at,
      reference_fee_percent: r.reference_fee_percent,
      ...(saved && {
        calculated_price: saved.calculated_price,
        calculated_fee: saved.calculated_fee,
        calculated_shipping_cost: saved.calculated_shipping_cost,
        calculated_at: saved.calculated_at,
      }),
    };
    });
    const { error: insertErr } = await supabase.from("pricing_cache").insert(toInsert);
    if (insertErr) return { ok: false, error: "Erro ao gravar cache" };
  }
  return { ok: true, count: uniqueRows.length };
}

/**
 * Atualiza apenas planned_price no cache para os itens informados (após salvar na tela de preços).
 */
export async function updatePricingCachePlannedPrices(
  accountId: string,
  updates: Array<{ item_id: string; variation_id: number | null; planned_price: number }>
): Promise<void> {
  if (updates.length === 0) return;
  const supabase = createServiceClient();
  for (const u of updates) {
    const vid = u.variation_id == null ? VARIATION_ID_ITEM : u.variation_id;
    await supabase
      .from("pricing_cache")
      .update({
        planned_price: u.planned_price,
        cache_updated_at: new Date().toISOString(),
      })
      .eq("account_id", accountId)
      .eq("item_id", u.item_id.trim().toUpperCase())
      .eq("variation_id", vid);
  }
}
