import type { SupabaseClient } from "@supabase/supabase-js";
import { runWithConcurrency } from "@/lib/mercadolivre/client";
import { fetchMlOrderById } from "@/lib/mercadolivre/orders-store";
import {
  fetchMlBillingOrderDetails,
  type MlBillingOrderDetail,
  type MlBillingPaymentInfo,
} from "./ml-billing-order-details";
import type { RecebimentoReleaseStatus, RecebimentoRow } from "./types";

export type DbRecebimentoOrder = {
  ml_order_id: string;
  status: string;
  date_created: string;
  marketplace_fee: number | null;
  shipping_cost_sender: number | null;
};

export type DbRecebimentoItem = {
  ml_order_id: string;
  item_id: string;
  quantity: number;
  unit_price: number | null;
  sale_fee: number | null;
  line_index: number;
};

export type BuildRecebimentoResult = {
  rows: RecebimentoRow[];
  billing_error: string | null;
  billing_forbidden: boolean;
  orders_from_api: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumTaxDetails(payment: MlBillingPaymentInfo | null): number {
  if (!payment?.tax_details?.length) return 0;
  let total = 0;
  for (const t of payment.tax_details) {
    if (t.tax_status && t.tax_status !== "applied") continue;
    const amt = Number(t.original_amount);
    const refunded = Number(t.refunded_amount);
    if (!Number.isFinite(amt)) continue;
    const net = amt - (Number.isFinite(refunded) ? refunded : 0);
    if (net > 0) total += net;
  }
  return round2(total);
}

function pickApprovedPayment(raw: Record<string, unknown>): Record<string, unknown> | null {
  const payments = raw.payments;
  if (!Array.isArray(payments)) return null;
  let fallback: Record<string, unknown> | null = null;
  for (const p of payments) {
    if (!p || typeof p !== "object") continue;
    const po = p as Record<string, unknown>;
    const st = String(po.status ?? "").toLowerCase();
    if (st === "approved") return po;
    if (!fallback && st) fallback = po;
  }
  return fallback;
}

function lineGross(items: DbRecebimentoItem[]): number {
  return items.reduce((s, it) => {
    const q = it.quantity > 0 ? it.quantity : 1;
    const p = it.unit_price != null && it.unit_price > 0 ? it.unit_price : 0;
    return s + p * q;
  }, 0);
}

function sumSaleFeeItems(items: DbRecebimentoItem[]): number | null {
  let total = 0;
  let any = false;
  for (const it of items) {
    if (it.sale_fee == null || !Number.isFinite(it.sale_fee)) continue;
    total += it.sale_fee * (it.quantity > 0 ? it.quantity : 1);
    any = true;
  }
  return any ? round2(total) : null;
}

function mapReleaseStatus(
  moneyReleaseDate: string | null,
  billingStatus: string | null
): RecebimentoReleaseStatus {
  const status = (billingStatus ?? "").toLowerCase();
  if (status === "released" || status === "paid") return "released";

  if (moneyReleaseDate) {
    const releaseTs = new Date(moneyReleaseDate).getTime();
    if (Number.isFinite(releaseTs) && releaseTs > Date.now()) return "scheduled";
  }

  if (status.includes("pending") || status.includes("process") || !status) return "pending";
  if (moneyReleaseDate) {
    const releaseTs = new Date(moneyReleaseDate).getTime();
    if (Number.isFinite(releaseTs) && releaseTs <= Date.now()) return "released";
  }
  return "pending";
}

function pickBillingPayment(
  billing: MlBillingOrderDetail | undefined,
  paymentIdHint: number | null
): MlBillingPaymentInfo | null {
  if (!billing?.payment_info?.length) return null;
  if (paymentIdHint != null) {
    const match = billing.payment_info.find((p) => p.payment_id === paymentIdHint);
    if (match) return match;
  }
  const approved = billing.payment_info.find((p) => (p.status ?? "").toLowerCase() === "approved");
  return approved ?? billing.payment_info[0] ?? null;
}

function buildItemTitle(
  items: DbRecebimentoItem[],
  titlesByItemId: Map<string, string>
): string {
  if (items.length === 0) return "—";
  const sorted = [...items].sort((a, b) => a.line_index - b.line_index);
  const first = sorted[0];
  const title = titlesByItemId.get(first.item_id.toUpperCase());
  if (title) {
    return items.length > 1 ? `${title} (+${items.length - 1} item)` : title;
  }
  return items.length > 1 ? `${first.item_id} (+${items.length - 1} item)` : first.item_id;
}

function buildRowForOrder(params: {
  order: DbRecebimentoOrder;
  items: DbRecebimentoItem[];
  titlesByItemId: Map<string, string>;
  billing: MlBillingOrderDetail | undefined;
  orderRaw: Record<string, unknown> | null;
}): RecebimentoRow {
  const { order, items, titlesByItemId, billing, orderRaw } = params;
  const paymentRaw = orderRaw ? pickApprovedPayment(orderRaw) : null;

  const paymentId = paymentRaw ? Number(paymentRaw.id) : null;
  const billingPayment = pickBillingPayment(billing, Number.isFinite(paymentId) ? paymentId : null);

  const transaction_amount = (() => {
    const fromPayment = paymentRaw ? Number(paymentRaw.transaction_amount) : NaN;
    if (Number.isFinite(fromPayment) && fromPayment > 0) return fromPayment;
    const gross = lineGross(items);
    if (gross > 0) return gross;
    const total = orderRaw ? Number(orderRaw.total_amount) : NaN;
    return Number.isFinite(total) && total > 0 ? total : 0;
  })();

  const saleFeeItems = sumSaleFeeItems(items);
  const marketplace_fee_net = (() => {
    if (billing?.sale_fee?.net != null) return billing.sale_fee.net;
    const mf = order.marketplace_fee;
    if (mf != null && Number.isFinite(mf)) return mf;
    if (paymentRaw) {
      const pmf = Number(paymentRaw.marketplace_fee);
      if (Number.isFinite(pmf) && pmf >= 0) return pmf;
    }
    return saleFeeItems ?? 0;
  })();

  const marketplace_fee_gross = billing?.sale_fee?.gross ?? marketplace_fee_net;
  const marketplace_fee_rebate = billing?.sale_fee?.rebate ?? 0;

  const shipping_cost = (() => {
    if (order.shipping_cost_sender != null && Number.isFinite(order.shipping_cost_sender)) {
      return order.shipping_cost_sender;
    }
    if (paymentRaw) {
      const sc = Number(paymentRaw.shipping_cost);
      if (Number.isFinite(sc) && sc >= 0) return sc;
    }
    return 0;
  })();

  const taxes_amount = (() => {
    const fromBilling = sumTaxDetails(billingPayment);
    if (fromBilling > 0) return fromBilling;
    if (paymentRaw) {
      const t = Number(paymentRaw.taxes_amount);
      if (Number.isFinite(t) && t > 0) return t;
    }
    return 0;
  })();

  const coupon_amount = paymentRaw ? Number(paymentRaw.coupon_amount) || 0 : 0;

  const net_to_receive = round2(
    transaction_amount -
      marketplace_fee_net -
      shipping_cost -
      taxes_amount +
      marketplace_fee_rebate
  );

  const money_release_date =
    billingPayment?.money_release_date ??
    (paymentRaw?.date_approved != null ? String(paymentRaw.date_approved) : order.date_created);

  const money_release_status = mapReleaseStatus(
    billingPayment?.money_release_date ?? null,
    billingPayment?.money_release_status ?? null
  );

  const data_source: RecebimentoRow["data_source"] =
    billing?.payment_info?.length || billing?.sale_fee
      ? billingPayment && paymentRaw
        ? "mixed"
        : "billing"
      : "orders";

  return {
    ml_order_id: order.ml_order_id,
    payment_id:
      billingPayment?.payment_id ??
      (Number.isFinite(paymentId) ? Math.trunc(paymentId!) : 0),
    payment_status:
      billingPayment?.status ??
      (paymentRaw ? String(paymentRaw.status ?? order.status) : order.status),
    payment_status_detail:
      billingPayment?.status_details ??
      (paymentRaw?.status_detail != null ? String(paymentRaw.status_detail) : null),
    payment_method_id:
      billingPayment?.payment_method_id ??
      (paymentRaw?.payment_method_id != null ? String(paymentRaw.payment_method_id) : "—"),
    payment_type_id:
      billingPayment?.payment_type_id ??
      (paymentRaw?.payment_type != null ? String(paymentRaw.payment_type) : "—"),
    date_approved:
      billingPayment?.date_approved ??
      (paymentRaw?.date_approved != null
        ? String(paymentRaw.date_approved)
        : order.date_created),
    money_release_date,
    money_release_days: billingPayment?.money_release_days ?? 0,
    money_release_status,
    transaction_amount: round2(transaction_amount),
    marketplace_fee_gross: round2(marketplace_fee_gross),
    marketplace_fee_net: round2(marketplace_fee_net),
    marketplace_fee_rebate: round2(marketplace_fee_rebate),
    shipping_cost: round2(shipping_cost),
    taxes_amount: round2(taxes_amount),
    coupon_amount: round2(Number.isFinite(coupon_amount) ? coupon_amount : 0),
    net_to_receive,
    installments: paymentRaw ? Math.max(1, Math.trunc(Number(paymentRaw.installments) || 1)) : 1,
    item_title: buildItemTitle(items, titlesByItemId),
    data_source,
  };
}

export async function buildRecebimentoRows(params: {
  supabase: SupabaseClient;
  accountId: string;
  accessToken: string;
  orders: DbRecebimentoOrder[];
  items: DbRecebimentoItem[];
}): Promise<BuildRecebimentoResult> {
  const { supabase, accountId, accessToken, orders, items } = params;
  const orderIds = orders.map((o) => o.ml_order_id);

  const itemsByOrder = new Map<string, DbRecebimentoItem[]>();
  for (const it of items) {
    const list = itemsByOrder.get(it.ml_order_id) ?? [];
    list.push(it);
    itemsByOrder.set(it.ml_order_id, list);
  }

  const itemIds = Array.from(new Set(items.map((i) => i.item_id.toUpperCase())));
  const titlesByItemId = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data: mlItems } = await supabase
      .from("ml_items")
      .select("item_id, title")
      .eq("account_id", accountId)
      .in("item_id", itemIds);
    for (const row of mlItems ?? []) {
      if (row.title) titlesByItemId.set(String(row.item_id).toUpperCase(), String(row.title));
    }
  }

  const billingResult = await fetchMlBillingOrderDetails(accessToken, orderIds);

  const needsOrderApi = orders.filter((o) => {
    const b = billingResult.byOrderId.get(o.ml_order_id);
    return !b?.payment_info?.length || o.marketplace_fee == null;
  });

  const orderRawById = new Map<string, Record<string, unknown>>();
  if (needsOrderApi.length > 0) {
    const fetched = await runWithConcurrency(needsOrderApi, 3, async (o) => {
      const raw = await fetchMlOrderById(accessToken, o.ml_order_id);
      return { id: o.ml_order_id, raw };
    });
    for (const { id, raw } of fetched) {
      if (raw) orderRawById.set(id, raw);
    }
  }

  const rows: RecebimentoRow[] = orders.map((order) =>
    buildRowForOrder({
      order,
      items: itemsByOrder.get(order.ml_order_id) ?? [],
      titlesByItemId,
      billing: billingResult.byOrderId.get(order.ml_order_id),
      orderRaw: orderRawById.get(order.ml_order_id) ?? null,
    })
  );

  rows.sort(
    (a, b) =>
      new Date(b.money_release_date).getTime() - new Date(a.money_release_date).getTime()
  );

  return {
    rows,
    billing_error: billingResult.error,
    billing_forbidden: billingResult.forbidden,
    orders_from_api: orderRawById.size,
  };
}
