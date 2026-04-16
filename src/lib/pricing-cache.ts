/**
 * Atualiza o cache da tela de preços (pricing_cache) para uma conta.
 * Junta ml_items, ml_variations, products, planned_prices e vendas 30d em uma única tabela
 * para leitura rápida com filtros.
 *
 * Chamado após: sync de anúncios, vínculo MLB-SKU, ou manualmente (POST /api/pricing/cache/refresh).
 */
import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
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
  sort_title: string;
  cache_updated_at: string;
}

export async function refreshPricingCache(accountId: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const supabase = createServiceClient();

  const { data: account, error: accountErr } = await supabase
    .from("ml_accounts")
    .select("id, ml_user_id")
    .eq("id", accountId)
    .single();

  if (accountErr || !account) {
    return { ok: false, error: "Conta não encontrada" };
  }

  const now = new Date().toISOString();

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

  const varItemIds = Array.from(new Set((variations as Array<{ item_id: string }>).map((v) => v.item_id)));
  let parentItems: Array<{ item_id: string; title: string | null; thumbnail: string | null; permalink: string | null; status: string | null; listing_type_id: string | null; category_id: string | null }> = [];
  if (varItemIds.length > 0) {
    for (let i = 0; i < varItemIds.length; i += PAGE_SIZE) {
      const ids = varItemIds.slice(i, i + PAGE_SIZE);
      const { data: parents } = await supabase
        .from("ml_items")
        .select("item_id, title, thumbnail, permalink, status, listing_type_id, category_id")
        .eq("account_id", accountId)
        .in("item_id", ids);
      parentItems = parentItems.concat(parents || []);
    }
  }
  const parentMap = new Map(parentItems.map((p: { item_id: string }) => [p.item_id, p]));

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
      ...(variations as Array<{ item_id: string }>).map((v) => v.item_id),
    ])
  );

  let salesMap: Record<string, number> = {};
  let ordersMap: Record<string, number> = {};
  if (allItemIds.length > 0) {
    const { data: tokenData } = await supabase
      .from("ml_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("account_id", accountId)
      .single();
    const token = tokenData as { access_token: string; refresh_token: string; expires_at: string } | null;
    if (token) {
      const accessToken = await getValidAccessToken(
        accountId,
        token.access_token,
        token.refresh_token,
        token.expires_at,
        supabase
      );
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
      sort_title: (title || "").toLowerCase(),
      cache_updated_at: now,
    });
  }

  for (const v of variations) {
    const raw = v as unknown as Record<string, unknown>;
    const parent = parentMap.get(raw.item_id as string) as Record<string, unknown> | undefined;
    const prod = raw.products as Record<string, unknown> | Record<string, unknown>[] | null;
    const p = Array.isArray(prod) ? prod[0] : prod;
    const productSku = p && typeof p.sku === "string" ? p.sku : null;
    const sku = extractSku((raw.raw_json as Record<string, unknown>) || null, productSku);
    const currentPrice = Number(raw.price) || 0;
    const vid = Number(raw.variation_id);
    const key = `${raw.item_id}:${vid}`;
    const plannedPrice = plannedByKey.get(key) ?? currentPrice;
    const parentTitle = (parent?.title as string) ?? "";
    const variationName = (raw.raw_json as Record<string, unknown>)?.attribute_combinations;
    let variationNameStr = "";
    if (Array.isArray(variationName)) {
      variationNameStr = variationName.map((a: { value_name?: string }) => a?.value_name ?? "").filter(Boolean).join(" / ");
    }
    const title = variationNameStr ? `${parentTitle} - ${variationNameStr}` : parentTitle;
    rows.push({
      id: cacheRowId(accountId, raw.item_id as string, vid),
      account_id: accountId,
      item_id: raw.item_id as string,
      variation_id: vid,
      title: title || null,
      thumbnail: (parent?.thumbnail as string) ?? null,
      permalink: (parent?.permalink as string) ?? null,
      status: (parent?.status as string) ?? null,
      listing_type_id: (parent?.listing_type_id as string) ?? null,
      category_id: (parent?.category_id as string) ?? null,
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
      sort_title: (parentTitle || "").toLowerCase(),
      cache_updated_at: now,
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
    const calcKey = `${r.item_id}:${r.variation_id}`;
    const saved = oldCalculated.get(calcKey);
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
      sort_title: r.sort_title,
      cache_updated_at: r.cache_updated_at,
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
    .select("id, ml_user_id")
    .eq("id", accountId)
    .single();
  if (accountErr || !account) return { ok: false, error: "Conta não encontrada" };

  const now = new Date().toISOString();
  const itemsSelect = `
    id, account_id, item_id, title, thumbnail, permalink, status, listing_type_id, category_id, price, raw_json, product_id,
    products:product_id (sku, cost_price, weight, height, width, length, tax_percent, extra_fee_percent, fixed_expenses)
  `;
  const variationsSelect = `
    id, account_id, item_id, variation_id, price, raw_json, product_id,
    products:product_id (sku, cost_price, weight, height, width, length, tax_percent, extra_fee_percent, fixed_expenses)
  `;

  const { data: items } = await supabase
    .from("ml_items")
    .select(itemsSelect)
    .eq("account_id", accountId)
    .eq("item_id", itemIdClean)
    .eq("has_variations", false);
  const { data: variations } = await supabase
    .from("ml_variations")
    .select(variationsSelect)
    .eq("account_id", accountId)
    .eq("item_id", itemIdClean);

  let parentItems: Array<{ item_id: string; title: string | null; thumbnail: string | null; permalink: string | null; status: string | null; listing_type_id: string | null; category_id: string | null }> = [];
  if ((variations?.length ?? 0) > 0) {
    const { data: parents } = await supabase
      .from("ml_items")
      .select("item_id, title, thumbnail, permalink, status, listing_type_id, category_id")
      .eq("account_id", accountId)
      .eq("item_id", itemIdClean);
    parentItems = parents || [];
  }
  const parentMap = new Map(parentItems.map((p: { item_id: string }) => [p.item_id, p]));

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
  const { data: tokenData } = await supabase.from("ml_tokens").select("access_token, refresh_token, expires_at").eq("account_id", accountId).single();
  const token = tokenData as { access_token: string; refresh_token: string; expires_at: string } | null;
  if (token) {
    const accessToken = await getValidAccessToken(accountId, token.access_token, token.refresh_token, token.expires_at, supabase);
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

  const toNum = (v: unknown): number | null => (v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
  const rows: PricingCacheRow[] = [];

  for (const item of items || []) {
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
      sort_title: (title || "").toLowerCase(),
      cache_updated_at: now,
    });
  }

  for (const v of variations || []) {
    const raw = v as unknown as Record<string, unknown>;
    const parent = parentMap.get(raw.item_id as string) as Record<string, unknown> | undefined;
    const prod = raw.products as Record<string, unknown> | Record<string, unknown>[] | null;
    const p = Array.isArray(prod) ? prod[0] : prod;
    const productSku = p && typeof p.sku === "string" ? p.sku : null;
    const sku = extractSku((raw.raw_json as Record<string, unknown>) || null, productSku);
    const currentPrice = Number(raw.price) || 0;
    const vid = Number(raw.variation_id);
    const key = `${raw.item_id}:${vid}`;
    const plannedPrice = plannedByKey.get(key) ?? currentPrice;
    const parentTitle = (parent?.title as string) ?? "";
    const variationName = (raw.raw_json as Record<string, unknown>)?.attribute_combinations;
    let variationNameStr = "";
    if (Array.isArray(variationName)) {
      variationNameStr = variationName.map((a: { value_name?: string }) => a?.value_name ?? "").filter(Boolean).join(" / ");
    }
    const title = variationNameStr ? `${parentTitle} - ${variationNameStr}` : parentTitle;
    rows.push({
      id: cacheRowId(accountId, raw.item_id as string, vid),
      account_id: accountId,
      item_id: raw.item_id as string,
      variation_id: vid,
      title: title || null,
      thumbnail: (parent?.thumbnail as string) ?? null,
      permalink: (parent?.permalink as string) ?? null,
      status: (parent?.status as string) ?? null,
      listing_type_id: (parent?.listing_type_id as string) ?? null,
      category_id: (parent?.category_id as string) ?? null,
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
      sort_title: (parentTitle || "").toLowerCase(),
      cache_updated_at: now,
    });
  }

  const rowsById = new Map<string, PricingCacheRow>();
  for (const r of rows) rowsById.set(r.id, r);
  const uniqueRows = Array.from(rowsById.values());

  await supabase.from("pricing_cache").delete().eq("account_id", accountId).eq("item_id", itemIdClean);
  if (uniqueRows.length > 0) {
    const toInsert = uniqueRows.map((r) => ({
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
      sort_title: r.sort_title,
      cache_updated_at: r.cache_updated_at,
    }));
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
