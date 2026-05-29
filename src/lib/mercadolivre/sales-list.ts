/**
 * Listagem de vendas persistidas (ml_orders + ml_order_items) com filtros no banco.
 * Sem filtros: últimos N pedidos. Com filtros: consulta completa (ex.: conferir Resumo 30d por MLB).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderLineInput } from "@/lib/pricing/order-sales-profit";
import { fetchAllViaRange } from "@/lib/table-pagination";

export const SALES_RECENT_ORDERS_LIMIT = 500;
/** Teto de pedidos quando há filtros ativos (evita timeout em contas enormes). */
export const SALES_FILTERED_ORDERS_MAX = 10_000;

export type SalesListStatusFilter = "" | "paid" | "cancelled" | "other";

export type SalesListFilters = {
  search?: string;
  status?: SalesListStatusFilter;
  dateFrom?: string;
  dateTo?: string;
  dispatchDateFrom?: string;
  dispatchDateTo?: string;
  tags?: string[];
};

export type SalesOrderRow = {
  ml_order_id: string;
  status: string;
  date_created: string;
  synced_at: string;
  shipping_id: string | null;
  shipping_logistic_mode: string | null;
  shipping_logistic_type: string | null;
  shipping_carrier: string | null;
  shipping_sla_expected_at: string | null;
  shipping_sla_status: string | null;
  shipping_cost_sender: number | null;
  marketplace_fee: number | null;
  tags: string[];
};

export type SalesListResult = {
  orders: SalesOrderRow[];
  items: OrderLineInput[];
  ordersTotal: number;
  linesTotal: number;
  listMode: "recent" | "filtered";
  recentLimitHit: boolean;
  filteredMaxHit: boolean;
};

const ORDER_SELECT =
  "ml_order_id, status, date_created, synced_at, shipping_id, shipping_logistic_mode, shipping_logistic_type, shipping_carrier, shipping_sla_expected_at, shipping_sla_status, shipping_cost_sender, marketplace_fee, tags";

export function salesListFiltersActive(filters: SalesListFilters): boolean {
  return !!(
    filters.search?.trim() ||
    filters.status ||
    filters.dateFrom?.trim() ||
    filters.dateTo?.trim() ||
    filters.dispatchDateFrom?.trim() ||
    filters.dispatchDateTo?.trim() ||
    (filters.tags && filters.tags.length > 0)
  );
}

function dateInputStartIso(dateFrom: string): string {
  const [y, m, d] = dateFrom.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function dateInputEndIso(dateTo: string): string {
  const [y, m, d] = dateTo.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
}

function mapOrderRow(raw: Record<string, unknown>): SalesOrderRow {
  return {
    ml_order_id: String(raw.ml_order_id),
    status: String(raw.status),
    date_created: String(raw.date_created),
    synced_at: String(raw.synced_at),
    shipping_id: raw.shipping_id != null ? String(raw.shipping_id) : null,
    shipping_logistic_mode:
      raw.shipping_logistic_mode != null ? String(raw.shipping_logistic_mode) : null,
    shipping_logistic_type:
      raw.shipping_logistic_type != null ? String(raw.shipping_logistic_type) : null,
    shipping_carrier: raw.shipping_carrier != null ? String(raw.shipping_carrier) : null,
    shipping_sla_expected_at:
      raw.shipping_sla_expected_at != null ? String(raw.shipping_sla_expected_at) : null,
    shipping_sla_status: raw.shipping_sla_status != null ? String(raw.shipping_sla_status) : null,
    shipping_cost_sender:
      raw.shipping_cost_sender != null && Number.isFinite(Number(raw.shipping_cost_sender))
        ? Number(raw.shipping_cost_sender)
        : null,
    marketplace_fee:
      raw.marketplace_fee != null && Number.isFinite(Number(raw.marketplace_fee))
        ? Number(raw.marketplace_fee)
        : null,
    tags: normalizeTags(raw.tags),
  };
}

function mapItemRow(raw: Record<string, unknown>): OrderLineInput {
  return {
    ml_order_id: String(raw.ml_order_id),
    item_id: String(raw.item_id).trim().toUpperCase(),
    variation_id:
      raw.variation_id != null &&
      Number.isFinite(Number(raw.variation_id)) &&
      Number(raw.variation_id) > 0
        ? Math.trunc(Number(raw.variation_id))
        : null,
    quantity: Number(raw.quantity) > 0 ? Math.trunc(Number(raw.quantity)) : 1,
    unit_price:
      raw.unit_price != null && Number.isFinite(Number(raw.unit_price))
        ? Number(raw.unit_price)
        : null,
    line_index: Number(raw.line_index) || 0,
    sale_fee:
      raw.sale_fee != null && Number.isFinite(Number(raw.sale_fee)) ? Number(raw.sale_fee) : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyStatusFilter(q: any, status: SalesListStatusFilter) {
  if (!status) return q;
  if (status === "paid") return q.eq("status", "paid");
  if (status === "cancelled") return q.in("status", ["cancelled", "canceled"]);
  return q;
}

function orderMatchesStatusFilter(status: string, filter: SalesListStatusFilter): boolean {
  if (!filter) return true;
  const s = status.toLowerCase();
  if (filter === "paid") return s === "paid";
  if (filter === "cancelled") return s === "cancelled" || s === "canceled";
  return s !== "paid" && s !== "cancelled" && s !== "canceled";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyOrderFilters(q: any, filters: SalesListFilters) {
  let next = q;
  next = applyStatusFilter(next, filters.status ?? "");
  if (filters.dateFrom?.trim()) {
    next = next.gte("date_created", dateInputStartIso(filters.dateFrom.trim()));
  }
  if (filters.dateTo?.trim()) {
    next = next.lte("date_created", dateInputEndIso(filters.dateTo.trim()));
  }
  if (filters.dispatchDateFrom?.trim()) {
    next = next.gte("shipping_sla_expected_at", dateInputStartIso(filters.dispatchDateFrom.trim()));
  }
  if (filters.dispatchDateTo?.trim()) {
    next = next.lte("shipping_sla_expected_at", dateInputEndIso(filters.dispatchDateTo.trim()));
  }
  if (filters.tags && filters.tags.length > 0) {
    next = next.overlaps("tags", filters.tags.map((t) => t.trim().toLowerCase()).filter(Boolean));
  }
  return next;
}

async function resolveOrderIdsForSearch(
  supabase: SupabaseClient,
  accountId: string,
  search: string
): Promise<string[]> {
  const term = search.trim();
  if (!term) return [];
  const withoutHash = term.startsWith("#") ? term.slice(1) : term;
  const pattern = withoutHash.replace(/[%_\\]/g, "\\$&");

  const { rows, error } = await fetchAllViaRange<{ ml_order_id: string }>((from, to) =>
    supabase
      .from("ml_order_items")
      .select("ml_order_id")
      .eq("account_id", accountId)
      .or(`item_id.ilike.%${pattern}%,ml_order_id.ilike.%${pattern}%`)
      .range(from, to)
  );
  if (error) throw error;

  const ids = new Set<string>();
  for (const row of rows) {
    if (row.ml_order_id) ids.add(String(row.ml_order_id));
  }
  return Array.from(ids);
}

async function fetchOrdersByIds(
  supabase: SupabaseClient,
  accountId: string,
  orderIds: string[],
  filters: SalesListFilters
): Promise<SalesOrderRow[]> {
  if (orderIds.length === 0) return [];
  const chunkSize = 200;
  const out: SalesOrderRow[] = [];
  for (let i = 0; i < orderIds.length; i += chunkSize) {
    const chunk = orderIds.slice(i, i + chunkSize);
    let q = supabase
      .from("ml_orders")
      .select(ORDER_SELECT)
      .eq("account_id", accountId)
      .in("ml_order_id", chunk);
    q = applyOrderFilters(q, filters);
    const { data, error } = await q;
    if (error) throw error;
    for (const row of data ?? []) {
      out.push(mapOrderRow(row as Record<string, unknown>));
    }
  }
  out.sort((a, b) => new Date(b.date_created).getTime() - new Date(a.date_created).getTime());
  return out;
}

async function fetchOrderItems(
  supabase: SupabaseClient,
  accountId: string,
  orderIds: string[],
  search?: string
): Promise<OrderLineInput[]> {
  if (orderIds.length === 0) return [];
  const term = search?.trim();
  const withoutHash = term?.startsWith("#") ? term.slice(1) : term;
  const pattern = withoutHash?.replace(/[%_\\]/g, "\\$&");
  const chunkSize = 200;
  const out: OrderLineInput[] = [];

  for (let i = 0; i < orderIds.length; i += chunkSize) {
    const chunk = orderIds.slice(i, i + chunkSize);
    let q = supabase
      .from("ml_order_items")
      .select("ml_order_id, item_id, variation_id, quantity, unit_price, line_index, sale_fee")
      .eq("account_id", accountId)
      .in("ml_order_id", chunk)
      .order("line_index", { ascending: true });
    if (pattern) {
      q = q.or(`item_id.ilike.%${pattern}%,ml_order_id.ilike.%${pattern}%`);
    }
    const { data, error } = await q;
    if (error) throw error;
    for (const row of data ?? []) {
      out.push(mapItemRow(row as Record<string, unknown>));
    }
  }
  return out;
}

export async function listSalesForAccount(
  supabase: SupabaseClient,
  accountId: string,
  filters: SalesListFilters
): Promise<SalesListResult> {
  const filteredMode = salesListFiltersActive(filters);
  let orders: SalesOrderRow[] = [];
  let recentLimitHit = false;
  let filteredMaxHit = false;

  if (filteredMode) {
    const searchIds = filters.search?.trim()
      ? await resolveOrderIdsForSearch(supabase, accountId, filters.search)
      : null;

    if (searchIds !== null && searchIds.length === 0) {
      return {
        orders: [],
        items: [],
        ordersTotal: 0,
        linesTotal: 0,
        listMode: "filtered",
        recentLimitHit: false,
        filteredMaxHit: false,
      };
    }

    if (searchIds !== null) {
      const cappedIds = searchIds.slice(0, SALES_FILTERED_ORDERS_MAX);
      filteredMaxHit = searchIds.length > SALES_FILTERED_ORDERS_MAX;
      orders = await fetchOrdersByIds(supabase, accountId, cappedIds, filters);
    } else {
      const maxRows = SALES_FILTERED_ORDERS_MAX;
      const { rows, total, error } = await fetchAllViaRange<Record<string, unknown>>(
        (from, to) => {
          let q = supabase
            .from("ml_orders")
            .select(ORDER_SELECT)
            .eq("account_id", accountId)
            .order("date_created", { ascending: false });
          q = applyOrderFilters(q, filters);
          return q.range(from, to);
        },
        { maxRows }
      );
      if (error) throw error;
      filteredMaxHit = (total ?? rows.length) > maxRows;
      orders = rows.map((r) => mapOrderRow(r));
    }
  } else {
    const { data, error } = await supabase
      .from("ml_orders")
      .select(ORDER_SELECT)
      .eq("account_id", accountId)
      .order("date_created", { ascending: false })
      .limit(SALES_RECENT_ORDERS_LIMIT);
    if (error) throw error;
    orders = (data ?? []).map((r) => mapOrderRow(r as Record<string, unknown>));
    recentLimitHit = orders.length >= SALES_RECENT_ORDERS_LIMIT;
  }

  const orderIds = orders.map((o) => o.ml_order_id);
  let items = await fetchOrderItems(
    supabase,
    accountId,
    orderIds,
    filteredMode ? filters.search : undefined
  );

  if (filters.status === "other") {
    orders = orders.filter((o) => orderMatchesStatusFilter(o.status, "other"));
    const allowed = new Set(orders.map((o) => o.ml_order_id));
    items = items.filter((it) => allowed.has(it.ml_order_id));
  }

  return {
    orders,
    items,
    ordersTotal: orders.length,
    linesTotal: items.length,
    listMode: filteredMode ? "filtered" : "recent",
    recentLimitHit,
    filteredMaxHit,
  };
}
