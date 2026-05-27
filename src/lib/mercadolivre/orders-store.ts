import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithRetry, runWithConcurrency } from "@/lib/mercadolivre/client";
import { parseMlOrderTags } from "@/lib/mercadolivre/order-tags";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";

const ORDERS_PAGE_LIMIT = 51;
const PRICING_CACHE_VARIATION_ID_ITEM = -1;

function normalizeItemIdKey(itemId: string): string {
  return String(itemId).trim().toUpperCase();
}

export type MlSalesMaps = {
  sales: Record<string, number>;
  orders: Record<string, number>;
  hasData: boolean;
};

export function last30DaysRangeIso(): { dateFrom: string; dateTo: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return {
    dateFrom: from.toISOString().replace(/\.\d{3}Z/, ".000Z"),
    dateTo: to.toISOString().replace(/\.\d{3}Z/, ".999Z"),
  };
}

function normalizeItemId(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  return /^ML[A-Z]?\d+$/i.test(s) ? s : null;
}

function parseMlDateIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type ParsedMlOrder = {
  ml_order_id: string;
  status: string;
  date_created: string;
  date_last_updated: string | null;
  shipping_id: string | null;
  /** Modo logístico (shipments.logistic.mode). */
  shipping_logistic_mode: string | null;
  /** Tipo logístico (shipments.logistic.type). */
  shipping_logistic_type: string | null;
  /** Transportadora (GET /shipments/{id}/carrier). */
  shipping_carrier: string | null;
  /** Entrega prevista (lead_time → estimated_delivery_final/time). */
  shipping_delivery_expected_at: string | null;
  /** Prazo máximo de despacho (GET /shipments/{id}/sla → expected_date). */
  shipping_sla_expected_at: string | null;
  /** Status SLA: on_time, delayed, early, etc. */
  shipping_sla_status: string | null;
  /** Frete pago pelo vendedor (GET /shipments/{id}/costs → senders[].cost). */
  shipping_cost_sender: number | null;
  /** Comissão no pagamento (payments[].marketplace_fee), quando disponível. */
  marketplace_fee: number | null;
  /** Tags da venda (order.tags no ML). */
  tags: string[];
  items: Array<{
    item_id: string;
    /** Variação vendida (order_items[].item.variation_id); null se não informado. */
    variation_id: number | null;
    quantity: number;
    unit_price: number | null;
    line_index: number;
    /** Comissão ML da linha (order_items[].sale_fee). */
    sale_fee: number | null;
  }>;
};

function parseOrderItemVariationId(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/** Normaliza payload GET /orders/{id} ou objeto em orders/search.results[]. */
export function parseMlOrderPayload(raw: Record<string, unknown>): ParsedMlOrder | null {
  const idRaw = raw.id ?? raw.order_id;
  if (idRaw == null || idRaw === "") return null;
  const ml_order_id = String(idRaw).trim();
  const status = String(raw.status ?? "unknown").trim().toLowerCase() || "unknown";
  const date_created = parseMlDateIso(raw.date_created);
  if (!date_created) return null;

  const items: ParsedMlOrder["items"] = [];
  const orderItems = raw.order_items;
  if (Array.isArray(orderItems)) {
    orderItems.forEach((row, line_index) => {
      if (!row || typeof row !== "object") return;
      const oi = row as Record<string, unknown>;
      const itemObj = oi.item;
      let item_id: string | null = null;
      if (itemObj && typeof itemObj === "object") {
        const io = itemObj as Record<string, unknown>;
        item_id =
          normalizeItemId(io.id) ??
          normalizeItemId(io.user_product_id) ??
          normalizeItemId(io.seller_custom_field);
      }
      if (!item_id) item_id = normalizeItemId(oi.item_id);
      if (!item_id) {
        const sellerSku = oi.seller_sku ?? oi.seller_custom_field;
        if (sellerSku != null && String(sellerSku).trim()) {
          const sku = String(sellerSku).trim().toUpperCase();
          if (/^ML[A-Z]?\d+$/i.test(sku)) item_id = sku;
        }
      }
      if (!item_id) return;
      let variation_id: number | null = null;
      if (itemObj && typeof itemObj === "object") {
        variation_id = parseOrderItemVariationId(
          (itemObj as Record<string, unknown>).variation_id
        );
      }
      if (variation_id == null) {
        variation_id = parseOrderItemVariationId(oi.variation_id);
      }
      const qty = Number(oi.quantity);
      const quantity = Number.isFinite(qty) && qty > 0 ? Math.trunc(qty) : 1;
      const up = Number(oi.unit_price);
      const unit_price = Number.isFinite(up) ? up : null;
      const sf = Number(oi.sale_fee);
      const sale_fee = Number.isFinite(sf) && sf >= 0 ? sf : null;
      items.push({ item_id, variation_id, quantity, unit_price, line_index, sale_fee });
    });
  }

  let shipping_id: string | null = null;
  const shippingRaw = raw.shipping;
  if (shippingRaw && typeof shippingRaw === "object") {
    const sid = (shippingRaw as Record<string, unknown>).id;
    if (sid != null && sid !== "") shipping_id = String(sid).trim();
  }

  let marketplace_fee: number | null = null;
  const payments = raw.payments;
  if (Array.isArray(payments)) {
    for (const p of payments) {
      if (!p || typeof p !== "object") continue;
      const po = p as Record<string, unknown>;
      const st = String(po.status ?? "").toLowerCase();
      if (st && st !== "approved") continue;
      const mf = Number(po.marketplace_fee);
      if (Number.isFinite(mf) && mf >= 0) {
        marketplace_fee = mf;
        break;
      }
    }
  }

  return {
    ml_order_id,
    status,
    date_created,
    date_last_updated: parseMlDateIso(raw.last_updated ?? raw.date_closed),
    shipping_id,
    shipping_logistic_mode: null,
    shipping_logistic_type: null,
    shipping_carrier: null,
    shipping_delivery_expected_at: null,
    shipping_sla_expected_at: null,
    shipping_sla_status: null,
    shipping_cost_sender: null,
    marketplace_fee,
    tags: parseMlOrderTags(raw.tags),
    items,
  };
}

export type MlShipmentShippingMeta = {
  shipping_cost_sender: number | null;
  shipping_logistic_mode: string | null;
  shipping_logistic_type: string | null;
  shipping_carrier: string | null;
  shipping_delivery_expected_at: string | null;
  shipping_sla_expected_at: string | null;
  shipping_sla_status: string | null;
};

function parseShipmentSenderCost(data: { senders?: Array<{ cost?: number }> }): number | null {
  let total = 0;
  let any = false;
  for (const s of data.senders ?? []) {
    const c = Number(s?.cost);
    if (Number.isFinite(c) && c > 0) {
      total += c;
      any = true;
    }
  }
  return any ? Math.round(total * 100) / 100 : 0;
}

/** Paralelismo na fase de envios do backfill (4 GETs por shipping_id, deduplicado). */
function getMlShipmentEnrichConcurrency(): number {
  const raw = process.env.ML_SHIPMENT_ENRICH_CONCURRENCY;
  if (raw === undefined || raw === "") return 2;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 8) return Math.floor(n);
  return 2;
}

function shipmentMetaToOrderPatch(meta: MlShipmentShippingMeta): Record<string, unknown> {
  return {
    shipping_cost_sender: meta.shipping_cost_sender,
    shipping_logistic_mode: meta.shipping_logistic_mode,
    shipping_logistic_type: meta.shipping_logistic_type,
    shipping_carrier: meta.shipping_carrier,
    shipping_sla_expected_at: meta.shipping_sla_expected_at,
    shipping_sla_status: meta.shipping_sla_status,
  };
}

/**
 * Busca meta de envio por shipping_id (deduplicado) e aplica em todos os pedidos da conta com esse envio.
 */
export async function enrichShipmentMetaForShippingIds(
  supabase: SupabaseClient,
  accountId: string,
  accessToken: string,
  shippingIds: string[],
  options?: {
    onProgress?: (done: number, total: number) => void | Promise<void>;
  }
): Promise<number> {
  const unique = Array.from(new Set(shippingIds.map((s) => String(s).trim()).filter(Boolean)));
  if (unique.length === 0) return 0;

  const concurrency = getMlShipmentEnrichConcurrency();
  const metaById = new Map<string, MlShipmentShippingMeta>();
  let done = 0;

  await runWithConcurrency(unique, concurrency, async (shippingId) => {
    const meta = await fetchMlShipmentShippingMeta(accessToken, shippingId);
    metaById.set(shippingId, meta);
    done += 1;
    await options?.onProgress?.(done, unique.length);
  });

  const now = new Date().toISOString();
  for (const [shippingId, meta] of metaById) {
    const { error } = await supabase
      .from("ml_orders")
      .update({ ...shipmentMetaToOrderPatch(meta), synced_at: now })
      .eq("account_id", accountId)
      .eq("shipping_id", shippingId);
    if (error) {
      console.warn(`[ml/orders-store] enrich shipment ${shippingId}`, error.message);
    }
  }

  return unique.length;
}

/** Custo, modo/tipo logístico e transportadora do envio (API ML). */
export async function fetchMlShipmentShippingMeta(
  accessToken: string,
  shippingId: string
): Promise<MlShipmentShippingMeta> {
  const empty: MlShipmentShippingMeta = {
    shipping_cost_sender: null,
    shipping_logistic_mode: null,
    shipping_logistic_type: null,
    shipping_carrier: null,
    shipping_delivery_expected_at: null,
    shipping_sla_expected_at: null,
    shipping_sla_status: null,
  };
  const id = String(shippingId).trim();
  if (!id) return empty;

  const base = `https://api.mercadolibre.com/shipments/${id}`;
  const fmtNew = { "x-format-new": "true" };

  const [shipmentRes, costsRes, carrierRes, slaRes] = await Promise.all([
    fetchWithRetry(base, accessToken, { headers: fmtNew }),
    fetchWithRetry(`${base}/costs`, accessToken, { headers: fmtNew }),
    fetchWithRetry(`${base}/carrier`, accessToken, { headers: fmtNew }),
    fetchWithRetry(`${base}/sla`, accessToken),
  ]);

  let shipping_cost_sender: number | null = null;
  if (costsRes.ok) {
    try {
      shipping_cost_sender = parseShipmentSenderCost(
        (await costsRes.json()) as { senders?: Array<{ cost?: number }> }
      );
    } catch {
      // ignore
    }
  } else {
    console.warn(`[ml/orders-store] GET shipments/${id}/costs ${costsRes.status}`);
  }

  let shipping_logistic_mode: string | null = null;
  let shipping_logistic_type: string | null = null;
  if (shipmentRes.ok) {
    try {
      const data = (await shipmentRes.json()) as {
        logistic?: { mode?: string; type?: string };
      };
      const mode = data.logistic?.mode;
      const type = data.logistic?.type;
      if (mode != null && String(mode).trim()) {
        shipping_logistic_mode = String(mode).trim().toLowerCase();
      }
      if (type != null && String(type).trim()) {
        shipping_logistic_type = String(type).trim().toLowerCase();
      }
    } catch {
      // ignore
    }
  } else {
    console.warn(`[ml/orders-store] GET shipments/${id} ${shipmentRes.status}`);
  }

  let shipping_carrier: string | null = null;
  if (carrierRes.ok) {
    try {
      const data = (await carrierRes.json()) as { name?: string };
      if (data.name != null && String(data.name).trim()) {
        shipping_carrier = String(data.name).trim();
      }
    } catch {
      // ignore
    }
  }

  let shipping_sla_expected_at: string | null = null;
  let shipping_sla_status: string | null = null;
  if (slaRes.ok) {
    try {
      const data = (await slaRes.json()) as { expected_date?: unknown; status?: unknown };
      shipping_sla_expected_at = parseMlDateIso(data.expected_date);
      if (data.status != null && String(data.status).trim()) {
        shipping_sla_status = String(data.status).trim().toLowerCase();
      }
    } catch {
      // ignore
    }
  }

  return {
    shipping_cost_sender,
    shipping_logistic_mode,
    shipping_logistic_type,
    shipping_carrier,
    shipping_delivery_expected_at: null,
    shipping_sla_expected_at,
    shipping_sla_status,
  };
}

/** Custo de frete do vendedor: GET /shipments/{id}/costs (doc ML — senders[].cost). */
export async function fetchMlShipmentSenderCost(
  accessToken: string,
  shippingId: string
): Promise<number | null> {
  const meta = await fetchMlShipmentShippingMeta(accessToken, shippingId);
  return meta.shipping_cost_sender;
}

export async function fetchMlOrderById(
  accessToken: string,
  orderId: string
): Promise<Record<string, unknown> | null> {
  const id = String(orderId).trim();
  if (!id) return null;
  const res = await fetch(`https://api.mercadolibre.com/orders/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[ml/orders-store] GET order ${id} ${res.status}:`, errText.slice(0, 200));
    return null;
  }
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Persiste pedido + itens (substitui linhas do pedido). */
export async function upsertMlOrderForAccount(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  parsed: ParsedMlOrder,
  options?: { accessToken?: string; skipShipmentEnrichment?: boolean }
): Promise<void> {
  const now = new Date().toISOString();
  let shippingCostSender = parsed.shipping_cost_sender;
  let shippingLogisticMode = parsed.shipping_logistic_mode;
  let shippingLogisticType = parsed.shipping_logistic_type;
  let shippingCarrier = parsed.shipping_carrier;
  let shippingSlaExpectedAt = parsed.shipping_sla_expected_at;
  let shippingSlaStatus = parsed.shipping_sla_status;

  if (parsed.shipping_id && options?.accessToken && !options?.skipShipmentEnrichment) {
    const needsMeta =
      shippingCostSender == null ||
      shippingLogisticMode == null ||
      shippingLogisticType == null ||
      shippingCarrier == null ||
      shippingSlaExpectedAt == null;
    if (needsMeta) {
      const meta = await fetchMlShipmentShippingMeta(
        options.accessToken,
        parsed.shipping_id
      );
      if (shippingCostSender == null) shippingCostSender = meta.shipping_cost_sender;
      if (shippingLogisticMode == null) shippingLogisticMode = meta.shipping_logistic_mode;
      if (shippingLogisticType == null) shippingLogisticType = meta.shipping_logistic_type;
      if (shippingCarrier == null) shippingCarrier = meta.shipping_carrier;
      if (shippingSlaExpectedAt == null) shippingSlaExpectedAt = meta.shipping_sla_expected_at;
      if (shippingSlaStatus == null) shippingSlaStatus = meta.shipping_sla_status;
    }
  }

  const { error: orderErr } = await supabase.from("ml_orders").upsert(
    {
      account_id: accountId,
      user_id: userId,
      ml_order_id: parsed.ml_order_id,
      status: parsed.status,
      date_created: parsed.date_created,
      date_last_updated: parsed.date_last_updated,
      shipping_id: parsed.shipping_id,
      shipping_logistic_mode: shippingLogisticMode,
      shipping_logistic_type: shippingLogisticType,
      shipping_carrier: shippingCarrier,
      shipping_delivery_expected_at: null,
      shipping_sla_expected_at: shippingSlaExpectedAt,
      shipping_sla_status: shippingSlaStatus,
      shipping_cost_sender: shippingCostSender,
      marketplace_fee: parsed.marketplace_fee,
      tags: parsed.tags,
      synced_at: now,
    },
    { onConflict: "account_id,ml_order_id" }
  );
  if (orderErr) throw orderErr;

  const { error: delErr } = await supabase
    .from("ml_order_items")
    .delete()
    .eq("account_id", accountId)
    .eq("ml_order_id", parsed.ml_order_id);
  if (delErr) throw delErr;

  if (parsed.items.length === 0) return;

  const rows = parsed.items.map((it) => ({
    account_id: accountId,
    user_id: userId,
    ml_order_id: parsed.ml_order_id,
    item_id: it.item_id,
    variation_id: it.variation_id,
    line_index: it.line_index,
    quantity: it.quantity,
    unit_price: it.unit_price,
    sale_fee: it.sale_fee,
    synced_at: now,
  }));

  const chunk = 100;
  for (let i = 0; i < rows.length; i += chunk) {
    const { error: insErr } = await supabase.from("ml_order_items").insert(rows.slice(i, i + chunk));
    if (insErr) throw insErr;
  }
}

async function fetchPaidOrdersSearchPage(
  accessToken: string,
  sellerId: number,
  dateFrom: string,
  dateTo: string,
  offset: number
): Promise<{
  results: Record<string, unknown>[];
  hasMore: boolean;
  nextOffset: number;
  total: number | null;
}> {
  const url = new URL("https://api.mercadolibre.com/orders/search");
  url.searchParams.set("seller", String(sellerId));
  url.searchParams.set("order.date_created.from", dateFrom);
  url.searchParams.set("order.date_created.to", dateTo);
  url.searchParams.set("order.status", "paid");
  url.searchParams.set("limit", String(ORDERS_PAGE_LIMIT));
  url.searchParams.set("offset", String(offset));

  const res = await fetchWithRetry(url.toString(), accessToken);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`orders/search ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    results?: Record<string, unknown>[];
    paging?: { total?: number; limit?: number; offset?: number };
  };
  const results = data.results ?? [];
  const total = Number(data.paging?.total ?? 0);
  const limit = Number(data.paging?.limit ?? ORDERS_PAGE_LIMIT);
  const currentOffset = Number(data.paging?.offset ?? offset);
  let hasMore = false;
  let nextOffset = currentOffset + limit;
  if (Number.isFinite(total) && total > 0) {
    hasMore = nextOffset < total;
  } else if (results.length >= ORDERS_PAGE_LIMIT) {
    hasMore = true;
  } else {
    hasMore = false;
    nextOffset = currentOffset + results.length;
  }
  const totalNum = Number.isFinite(total) && total > 0 ? total : null;
  return { results, hasMore, nextOffset, total: totalNum };
}

export type SalesBackfillProgress = {
  processed: number;
  total: number;
  ordersUpserted: number;
  itemsUpserted: number;
  phase: "orders" | "shipments" | "pricing_cache";
  shipmentsProcessed?: number;
  shipmentsTotal?: number;
};

export type Backfill30dResult = {
  ok: true;
  ordersUpserted: number;
  itemsUpserted: number;
  shipmentsEnriched: number;
};

/**
 * Carga inicial: todos os pedidos pagos dos últimos 30 dias do vendedor (uma busca paginada, não por MLB).
 */
export async function backfillPaidOrdersLast30Days(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  accessToken: string,
  sellerId: number,
  options?: {
    skipShipmentEnrichment?: boolean;
    onProgress?: (progress: SalesBackfillProgress) => void | Promise<void>;
  }
): Promise<Backfill30dResult> {
  const { dateFrom, dateTo } = last30DaysRangeIso();
  let offset = 0;
  let hasMore = true;
  let ordersUpserted = 0;
  let itemsUpserted = 0;
  let orderTotal: number | null = null;
  const affectedItemIds = new Set<string>();
  const shippingIds = new Set<string>();
  const enrichShipments = !options?.skipShipmentEnrichment;
  let shipmentsEnriched = 0;

  const reportProgress = async (phase: SalesBackfillProgress["phase"]) => {
    if (!options?.onProgress) return;
    const orderCap = orderTotal ?? Math.max(ordersUpserted, 1);
    const shipTotal = shippingIds.size;
    const shipDone = shipmentsEnriched;

    let combinedTotal: number;
    let combinedProcessed: number;
    if (phase === "orders") {
      combinedTotal = orderCap;
      combinedProcessed = ordersUpserted;
    } else if (phase === "shipments") {
      combinedTotal = orderCap + shipTotal;
      combinedProcessed = ordersUpserted + shipDone;
    } else {
      combinedTotal = orderCap + (enrichShipments ? shipTotal : 0);
      combinedProcessed = ordersUpserted + (enrichShipments ? shipTotal : 0);
    }

    await options.onProgress({
      processed: combinedProcessed,
      total: combinedTotal,
      ordersUpserted,
      itemsUpserted,
      phase,
      shipmentsProcessed: shipDone,
      shipmentsTotal: shipTotal,
    });
  };

  await supabase.from("ml_sales_sync_state").upsert(
    {
      account_id: accountId,
      user_id: userId,
      initial_backfill_status: "running",
      initial_backfill_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id" }
  );

  try {
    await reportProgress("orders");
    while (hasMore) {
      const page = await fetchPaidOrdersSearchPage(accessToken, sellerId, dateFrom, dateTo, offset);
      if (orderTotal == null && page.total != null) orderTotal = page.total;
      for (const raw of page.results) {
        const parsed = parseMlOrderPayload(raw);
        if (!parsed) continue;
        await upsertMlOrderForAccount(supabase, accountId, userId, parsed, {
          accessToken,
          skipShipmentEnrichment: true,
        });
        if (enrichShipments && parsed.shipping_id) {
          shippingIds.add(parsed.shipping_id);
        }
        ordersUpserted += 1;
        itemsUpserted += parsed.items.length;
        for (const it of parsed.items) affectedItemIds.add(it.item_id);
      }
      hasMore = page.hasMore;
      offset = page.nextOffset;
      await reportProgress("orders");
    }

    if (enrichShipments && shippingIds.size > 0) {
      await reportProgress("shipments");
      shipmentsEnriched = await enrichShipmentMetaForShippingIds(
        supabase,
        accountId,
        accessToken,
        Array.from(shippingIds),
        {
          onProgress: async (done) => {
            shipmentsEnriched = done;
            await reportProgress("shipments");
          },
        }
      );
    }

    const itemIdList = Array.from(affectedItemIds);
    if (itemIdList.length > 0) {
      await reportProgress("pricing_cache");
      const PATCH_BATCH = 200;
      for (let i = 0; i < itemIdList.length; i += PATCH_BATCH) {
        try {
          await patchPricingCacheSales30dForItems(
            supabase,
            accountId,
            itemIdList.slice(i, i + PATCH_BATCH)
          );
        } catch (e) {
          console.warn("[ml/orders-store] patch pricing_cache após backfill", e);
        }
      }
    }

    await supabase.from("ml_sales_sync_state").upsert(
      {
        account_id: accountId,
        user_id: userId,
        initial_backfill_status: "done",
        initial_backfill_at: new Date().toISOString(),
        initial_backfill_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" }
    );

    return { ok: true, ordersUpserted, itemsUpserted, shipmentsEnriched };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("ml_sales_sync_state").upsert(
      {
        account_id: accountId,
        user_id: userId,
        initial_backfill_status: "error",
        initial_backfill_error: msg.slice(0, 500),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" }
    );
    throw e;
  }
}

export type SyncMlOrderResult =
  | { ok: true; ml_order_id: string; item_ids: string[] }
  | { ok: false; reason: string };

export async function syncMlOrderFromApi(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  accessToken: string,
  mlOrderId: string
): Promise<SyncMlOrderResult> {
  const id = String(mlOrderId).trim();
  const raw = await fetchMlOrderById(accessToken, id);
  if (!raw) {
    return { ok: false, reason: `GET /orders/${id} falhou ou pedido indisponível` };
  }
  const parsed = parseMlOrderPayload(raw);
  if (!parsed) {
    return {
      ok: false,
      reason: `Resposta do ML sem date_created ou formato não reconhecido (order ${id})`,
    };
  }
  await upsertMlOrderForAccount(supabase, accountId, userId, parsed, { accessToken });
  await supabase.from("ml_sales_sync_state").upsert(
    {
      account_id: accountId,
      user_id: userId,
      last_webhook_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id" }
  );

  const itemIds = parsed.items.map((it) => it.item_id);
  if (itemIds.length > 0) {
    try {
      await patchPricingCacheSales30dForItems(supabase, accountId, itemIds);
    } catch (e) {
      console.warn("[ml/orders-store] patch pricing_cache sales 30d", e);
    }
  }
  return { ok: true, ml_order_id: parsed.ml_order_id, item_ids: parsed.items.map((i) => i.item_id) };
}

/** Agrega vendas 30d para MLB(s) específicos (webhook / atualização pontual). */
export async function aggregateSales30dForItemIds(
  supabase: SupabaseClient,
  accountId: string,
  itemIds: string[]
): Promise<MlSalesMaps> {
  const sales: Record<string, number> = {};
  const orders: Record<string, number> = {};
  const normalized = Array.from(new Set(itemIds.map(normalizeItemIdKey).filter(Boolean)));
  if (normalized.length === 0) return { sales, orders, hasData: false };

  for (const id of normalized) {
    sales[id] = 0;
    orders[id] = 0;
  }

  const { data, error } = await supabase.rpc("aggregate_ml_item_sales_30d_for_items", {
    p_account_id: accountId,
    p_item_ids: normalized,
  });

  if (error) {
    console.warn("[ml/orders-store] aggregate_ml_item_sales_30d_for_items", error);
    const fallback = await aggregateSales30dFromDb(supabase, accountId);
    for (const id of normalized) {
      sales[id] = fallback.sales[id] ?? 0;
      orders[id] = fallback.orders[id] ?? 0;
    }
    return { sales, orders, hasData: fallback.hasData };
  }

  const rows = (data ?? []) as Array<{
    item_id?: string;
    quantity?: number | string;
    order_count?: number | string;
  }>;
  for (const row of rows) {
    const itemId = normalizeItemIdKey(String(row.item_id ?? ""));
    if (!itemId) continue;
    const qty = Number(row.quantity);
    const ord = Number(row.order_count);
    sales[itemId] = Number.isFinite(qty) ? qty : 0;
    orders[itemId] = Number.isFinite(ord) ? ord : 0;
  }
  return { sales, orders, hasData: true };
}

/**
 * Atualiza `orders_30d` / `sales_30d` em pricing_cache para os MLB informados
 * (coluna Vendas 30d na tela Preços).
 */
export async function patchPricingCacheSales30dForItems(
  supabase: SupabaseClient,
  accountId: string,
  itemIds: string[]
): Promise<void> {
  const normalized = Array.from(new Set(itemIds.map(normalizeItemIdKey).filter(Boolean)));
  if (normalized.length === 0) return;

  const { sales, orders } = await aggregateSales30dForItemIds(supabase, accountId, normalized);
  const BATCH = 40;
  for (let i = 0; i < normalized.length; i += BATCH) {
    const slice = normalized.slice(i, i + BATCH);
    await Promise.all(
      slice.map((itemId) =>
        supabase
          .from("pricing_cache")
          .update({
            orders_30d: orders[itemId] ?? 0,
            sales_30d: sales[itemId] ?? 0,
          })
          .eq("account_id", accountId)
          .eq("item_id", itemId)
          .eq("variation_id", PRICING_CACHE_VARIATION_ID_ITEM)
      )
    );
  }
}

/** Agrega vendas 30d a partir do banco (função SQL). */
export async function aggregateSales30dFromDb(
  supabase: SupabaseClient,
  accountId: string
): Promise<MlSalesMaps> {
  const sales: Record<string, number> = {};
  const orders: Record<string, number> = {};

  const { data, error } = await supabase.rpc("aggregate_ml_item_sales_30d", {
    p_account_id: accountId,
  });

  if (error) {
    console.warn("[ml/orders-store] aggregate_ml_item_sales_30d", error);
    return { sales, orders, hasData: false };
  }

  const rows = (data ?? []) as Array<{
    item_id?: string;
    quantity?: number | string;
    order_count?: number | string;
  }>;

  for (const row of rows) {
    const itemId = normalizeItemId(row.item_id);
    if (!itemId) continue;
    const qty = Number(row.quantity);
    const ord = Number(row.order_count);
    sales[itemId] = Number.isFinite(qty) ? qty : 0;
    orders[itemId] = Number.isFinite(ord) ? ord : 0;
  }

  const hasData = rows.length > 0;
  return { sales, orders, hasData };
}

/** Resolve token e executa backfill para a conta. */
export async function runSalesBackfillForAccount(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  mlUserId: number,
  options?: {
    skipShipmentEnrichment?: boolean;
    onProgress?: (progress: SalesBackfillProgress) => void | Promise<void>;
  }
): Promise<Backfill30dResult> {
  const { data: tokenData, error: tokenErr } = await supabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", accountId)
    .single();
  if (tokenErr || !tokenData) {
    throw new Error("Token Mercado Livre não encontrado");
  }
  const tr = tokenData as { access_token: string; refresh_token: string; expires_at: string };
  const accessToken = await getValidAccessToken(
    accountId,
    tr.access_token,
    tr.refresh_token,
    tr.expires_at,
    supabase
  );
  if (!accessToken) throw new Error("Não foi possível obter access token válido");
  return backfillPaidOrdersLast30Days(supabase, accountId, userId, accessToken, mlUserId, options);
}

/** Backfill em `running` sem atualização recente (processo caiu ou proxy cortou). */
/** Alinhado ao timeout de job running (enriquecimento de envio por pedido). */
export const SALES_BACKFILL_STALE_MS = 3 * 60 * 60 * 1000;

export function isSalesBackfillStale(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return true;
  const t = new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > SALES_BACKFILL_STALE_MS;
}
