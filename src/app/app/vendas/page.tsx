"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppTable,
  AppTableBodyRow,
  AppTableHead,
  AppTableHeadRow,
  AppTableTd,
  AppTableTh,
} from "@/components/AppTable";
import { OnboardingGate } from "@/components/OnboardingGate";
import { SmartLoaderOverlay } from "@/components/SmartLoaderOverlay";
import { TablePageSizeSelect } from "@/components/TablePageSizeSelect";
import { computeTotalPages, isAllPageSize } from "@/lib/table-pagination";
import {
  formatMlOrderTagLabel,
  mlOrderTagBadgeClass,
} from "@/lib/mercadolivre/order-tags";

const IS_NEXT_DEV = process.env.NODE_ENV === "development";
const SALES_ORDERS_FETCH_LIMIT = 500;
const ORDERS_PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200] as const;

type OrderStatusFilter = "" | "paid" | "cancelled" | "other";

type VendasTab = "vendas" | "resumo" | "como-funciona";

type SyncState = {
  initial_backfill_status?: string;
  initial_backfill_at?: string | null;
  initial_backfill_error?: string | null;
  last_webhook_sync_at?: string | null;
};

type OrderRow = {
  ml_order_id: string;
  status: string;
  date_created: string;
  synced_at: string;
  tags: string[];
};

type ItemRow = {
  ml_order_id: string;
  item_id: string;
  quantity: number;
  unit_price: number | null;
  line_index: number;
};

type OrderLineProfitRow = ItemRow & {
  sku: string | null;
  cost_price: number | null;
  sale_price: number | null;
  fee: number | null;
  shipping_cost: number | null;
  profit: number | null;
  profit_percent: number | null;
  line_profit: number | null;
  profit_error: string | null;
  fee_ml: number | null;
  shipping_ml: number | null;
  line_profit_ml: number | null;
  profit_ml: number | null;
  profit_percent_ml: number | null;
  ml_data_error: string | null;
};

type AggRow = {
  item_id: string;
  order_count: number;
  quantity: number;
};

type OrderLineTableRow = OrderLineProfitRow & {
  status: string;
  date_created: string;
  tags: string[];
};

function normalizeOrderTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
}

function matchesOrderTagsFilter(tags: string[], filterTags: string[]): boolean {
  if (filterTags.length === 0) return true;
  if (tags.length === 0) return false;
  return filterTags.some((t) => tags.includes(t));
}

function OrderTagsBadges({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <div className="flex max-w-[14rem] flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          title={tag}
          className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight ${mlOrderTagBadgeClass(tag)}`}
        >
          {formatMlOrderTagLabel(tag)}
        </span>
      ))}
    </div>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 6h16M7 12h10M10 18h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function VendasHelpContent() {
  return (
    <div className="space-y-4 text-sm text-fg">
      <h2 className="text-lg font-semibold text-fg-strong">Vendas Mercado Livre</h2>
      <section>
        <h3 className="mb-2 font-medium text-fg-strong">Objetivo</h3>
        <p>
          Persistir pedidos do Mercado Livre no banco (<code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">ml_orders</code> /{" "}
          <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">ml_order_items</code>) e alimentar a coluna{" "}
          <strong>Vendas 30d</strong> na tela Preços sem consultar a API a cada refresh.
        </p>
      </section>
      <section>
        <h3 className="mb-2 font-medium text-fg-strong">Fluxo</h3>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong>Carga inicial 30 dias</strong> — busca pedidos pagos no ML e grava no banco (ferramenta de suporte em desenvolvimento).
          </li>
          <li>
            <strong>Webhooks</strong> (<code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">orders_v2</code>) — cada pedido novo ou
            alterado atualiza o banco e recalcula <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">pricing_cache.orders_30d</code>{" "}
            dos MLB do pedido.
          </li>
          <li>
            A aba <strong>Resumo 30d</strong> mostra o mesmo critério da coluna Preços: pedidos pagos nos últimos 30 dias por MLB.
          </li>
          <li>
            Cada pedido traz <strong>tags</strong> do ML (<code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">order.tags</code>
            ), como <em>paid</em>, <em>delivered</em>, <em>pack_order</em> — visíveis na aba Vendas e filtráveis.
          </li>
        </ul>
      </section>
    </div>
  );
}

function syncStatusBadge(status: string | undefined): { label: string; className: string } {
  const s = (status ?? "idle").toLowerCase();
  if (s === "done") {
    return {
      label: "Backfill concluído",
      className: "bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-200",
    };
  }
  if (s === "running") {
    return {
      label: "Backfill em andamento",
      className: "bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    };
  }
  if (s === "error") {
    return {
      label: "Erro no backfill",
      className: "bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    };
  }
  return {
    label: "Aguardando carga inicial",
    className: "bg-gray-200 text-fg dark:bg-slate-600 dark:text-slate-200",
  };
}

function formatBRL(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDelta(real: number | null, estimated: number | null): string | null {
  if (real == null || estimated == null || !Number.isFinite(real) || !Number.isFinite(estimated)) {
    return null;
  }
  const d = Math.round((real - estimated) * 100) / 100;
  if (Math.abs(d) < 0.005) return "0";
  return `${d > 0 ? "+" : ""}${formatBRL(d)}`;
}

function CompareValueCell({
  labelReal,
  labelEst,
  real,
  estimated,
  realTitle,
  estTitle,
}: {
  labelReal: string;
  labelEst: string;
  real: number | null;
  estimated: number | null;
  realTitle?: string;
  estTitle?: string;
}) {
  const delta = formatDelta(real, estimated);
  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      <div title={realTitle}>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">{labelReal}</span>
        <span className="ml-1 font-medium text-slate-800 dark:text-slate-100">
          {real != null ? `R$ ${formatBRL(real)}` : "—"}
        </span>
      </div>
      <div title={estTitle}>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">{labelEst}</span>
        <span className="ml-1 text-amber-700 dark:text-amber-500">
          {estimated != null ? `R$ ${formatBRL(estimated)}` : "—"}
        </span>
      </div>
      {delta != null && real != null && estimated != null && (
        <span
          className={`text-[10px] tabular-nums ${
            delta === "0" ? "text-slate-400" : real > estimated ? "text-red-500" : "text-green-600"
          }`}
          title="Real − estimado"
        >
          Δ {delta}
        </span>
      )}
    </div>
  );
}

function normalizeOrderStatus(status: string): string {
  return status.toLowerCase();
}

function matchesOrderStatusFilter(status: string, filter: OrderStatusFilter): boolean {
  if (!filter) return true;
  const s = normalizeOrderStatus(status);
  if (filter === "paid") return s === "paid";
  if (filter === "cancelled") return s === "cancelled" || s === "canceled";
  return s !== "paid" && s !== "cancelled" && s !== "canceled";
}

function formatFilterDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
}

function matchesOrderDateRange(dateCreated: string, dateFrom: string, dateTo: string): boolean {
  if (!dateFrom && !dateTo) return true;
  const t = new Date(dateCreated).getTime();
  if (!Number.isFinite(t)) return false;

  if (dateFrom) {
    const [y, m, d] = dateFrom.split("-").map(Number);
    const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    if (t < start) return false;
  }
  if (dateTo) {
    const [y, m, d] = dateTo.split("-").map(Number);
    const end = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    if (t > end) return false;
  }
  return true;
}

function matchesOrderLineSearch(row: OrderLineTableRow, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  const orderId = row.ml_order_id.toLowerCase();
  const withoutHash = term.startsWith("#") ? term.slice(1) : term;
  if (orderId.includes(withoutHash)) return true;
  if (row.item_id.toLowerCase().includes(term)) return true;
  if (row.sku?.toLowerCase().includes(term)) return true;
  return false;
}

function CopyableCell({
  value,
  cellId,
  copiedCell,
  onCopy,
  className = "",
  display,
}: {
  value: string;
  cellId: string;
  copiedCell: string | null;
  onCopy: (text: string, cellId: string) => void;
  className?: string;
  display?: React.ReactNode;
}) {
  if (!value.trim()) {
    return <span className="text-slate-400">—</span>;
  }
  const copied = copiedCell === cellId;
  return (
    <button
      type="button"
      onClick={() => onCopy(value, cellId)}
      title="Clique para copiar"
      className={`pricing-cell-chip text-left -mx-1 py-0.5 ${className}`}
    >
      {copied ? (
        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Copiado!</span>
      ) : (
        display ?? value
      )}
    </button>
  );
}

function orderStatusBadge(status: string): { label: string; className: string } {
  const s = status.toLowerCase();
  if (s === "paid") {
    return {
      label: "Pago",
      className: "bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-200",
    };
  }
  if (s === "cancelled" || s === "canceled") {
    return {
      label: "Cancelado",
      className: "bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    };
  }
  return {
    label: status,
    className: "bg-gray-200 text-fg dark:bg-slate-600 dark:text-slate-200",
  };
}

function VendasPageContent() {
  const [tab, setTab] = useState<VendasTab>("vendas");
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [syncingPending, setSyncingPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [orderLinesProfit, setOrderLinesProfit] = useState<OrderLineProfitRow[]>([]);
  const [profitCalcNote, setProfitCalcNote] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<AggRow[]>([]);
  const [hasAggregate, setHasAggregate] = useState(false);

  const [ordersSearch, setOrdersSearch] = useState("");
  const [ordersStatusFilter, setOrdersStatusFilter] = useState<OrderStatusFilter>("");
  const [ordersDateFrom, setOrdersDateFrom] = useState("");
  const [ordersDateTo, setOrdersDateTo] = useState("");
  const [ordersFiltersModalOpen, setOrdersFiltersModalOpen] = useState(false);
  const [draftOrdersSearch, setDraftOrdersSearch] = useState("");
  const [draftOrdersStatusFilter, setDraftOrdersStatusFilter] = useState<OrderStatusFilter>("");
  const [draftOrdersDateFrom, setDraftOrdersDateFrom] = useState("");
  const [draftOrdersDateTo, setDraftOrdersDateTo] = useState("");
  const [ordersTagFilter, setOrdersTagFilter] = useState<string[]>([]);
  const [draftOrdersTagFilter, setDraftOrdersTagFilter] = useState<string[]>([]);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPageSize, setOrdersPageSize] = useState(25);
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  const copyToClipboard = useCallback((text: string, cellId: string) => {
    if (!text.trim()) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCell(cellId);
      setTimeout(() => setCopiedCell(null), 1800);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales?limit=${SALES_ORDERS_FETCH_LIMIT}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Falha ao carregar");
        return;
      }
      setSyncState(data.sync_state ?? null);
      setOrders(
        (data.recent_orders ?? []).map((o: OrderRow & { tags?: unknown }) => ({
          ...o,
          tags: normalizeOrderTags(o.tags),
        }))
      );
      setItems(data.order_items ?? []);
      setOrderLinesProfit(data.order_items_profit ?? []);
      setProfitCalcNote(data.profit_calc_note ?? null);
      setAggregate(data.aggregate_30d ?? []);
      setHasAggregate(Boolean(data.has_aggregate_data));
    } catch {
      setError("Erro de rede");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runSyncPendingWebhooks = async () => {
    setSyncingPending(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/sales-sync-pending", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Falha ao reprocessar webhooks");
        return;
      }
      alert(
        `Webhooks pendentes: ${data.scanned} analisado(s), ${data.synced} sincronizado(s), ${data.failed} falha(s).` +
          (data.order_ids?.length
            ? `\nPedidos: ${(data.order_ids as string[]).slice(0, 8).join(", ")}${data.order_ids.length > 8 ? "…" : ""}`
            : "")
      );
      await load();
    } catch {
      setError("Erro de rede ao reprocessar webhooks");
    } finally {
      setSyncingPending(false);
    }
  };

  const runBackfill = async () => {
    if (
      !confirm(
        "Buscar no ML todos os pedidos pagos dos últimos 30 dias e gravar no banco? Pode levar alguns minutos."
      )
    ) {
      return;
    }
    setBackfilling(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/sales-backfill", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Falha na carga inicial");
        return;
      }
      alert(
        `Carga concluída: ${data.orders_upserted} pedido(s), ${data.items_upserted} linha(s) de item.`
      );
      await load();
    } catch {
      setError("Erro de rede na carga inicial");
    } finally {
      setBackfilling(false);
    }
  };

  const orderById = useMemo(() => {
    const map = new Map<string, OrderRow>();
    for (const o of orders) map.set(o.ml_order_id, o);
    return map;
  }, [orders]);

  const orderLineTableRows: OrderLineTableRow[] = useMemo(() => {
    const profitByKey = new Map<string, OrderLineProfitRow>();
    for (const row of orderLinesProfit) {
      profitByKey.set(`${row.ml_order_id}:${row.line_index}:${row.item_id}`, row);
    }

    const source =
      orderLinesProfit.length > 0
        ? orderLinesProfit
        : items.map((it) => ({
            ...it,
            sku: null,
            cost_price: null,
            sale_price: it.unit_price,
            fee: null,
            shipping_cost: null,
            profit: null,
            profit_percent: null,
            line_profit: null,
            profit_error: null,
            fee_ml: null,
            shipping_ml: null,
            line_profit_ml: null,
            profit_ml: null,
            profit_percent_ml: null,
            ml_data_error: null,
          }));

    return source
      .map((line) => {
        const order = orderById.get(line.ml_order_id);
        if (!order) return null;
        const enriched =
          profitByKey.get(`${line.ml_order_id}:${line.line_index}:${line.item_id}`) ?? line;
        return {
          ...enriched,
          status: order.status,
          date_created: order.date_created,
          tags: order.tags ?? [],
        };
      })
      .filter((r): r is OrderLineTableRow => r != null)
      .sort((a, b) => {
        const t = new Date(b.date_created).getTime() - new Date(a.date_created).getTime();
        if (t !== 0) return t;
        if (a.ml_order_id !== b.ml_order_id) return a.ml_order_id.localeCompare(b.ml_order_id);
        return a.line_index - b.line_index;
      });
  }, [orderLinesProfit, items, orderById]);

  const filteredOrderLines = useMemo(() => {
    return orderLineTableRows.filter(
      (row) =>
        matchesOrderLineSearch(row, ordersSearch) &&
        matchesOrderStatusFilter(row.status, ordersStatusFilter) &&
        matchesOrderDateRange(row.date_created, ordersDateFrom, ordersDateTo) &&
        matchesOrderTagsFilter(row.tags, ordersTagFilter)
    );
  }, [
    orderLineTableRows,
    ordersSearch,
    ordersStatusFilter,
    ordersDateFrom,
    ordersDateTo,
    ordersTagFilter,
  ]);

  const availableOrderTags = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      for (const t of o.tags ?? []) set.add(t);
    }
    return [...set].sort((a, b) => formatMlOrderTagLabel(a).localeCompare(formatMlOrderTagLabel(b)));
  }, [orders]);

  const ordersTotalPages = computeTotalPages(filteredOrderLines.length, ordersPageSize);

  const paginatedOrderLines = useMemo(() => {
    if (isAllPageSize(ordersPageSize)) return filteredOrderLines;
    const start = (ordersPage - 1) * ordersPageSize;
    return filteredOrderLines.slice(start, start + ordersPageSize);
  }, [filteredOrderLines, ordersPage, ordersPageSize]);

  const appliedOrdersFilters = useMemo(() => {
    const labels: string[] = [];
    if (ordersSearch.trim()) labels.push(`Busca: ${ordersSearch.trim()}`);
    if (ordersStatusFilter === "paid") labels.push("Status: Pago");
    if (ordersStatusFilter === "cancelled") labels.push("Status: Cancelado");
    if (ordersStatusFilter === "other") labels.push("Status: Outros");
    if (ordersDateFrom && ordersDateTo) {
      labels.push(
        `Período: ${formatFilterDateLabel(ordersDateFrom)} – ${formatFilterDateLabel(ordersDateTo)}`
      );
    } else if (ordersDateFrom) {
      labels.push(`De: ${formatFilterDateLabel(ordersDateFrom)}`);
    } else if (ordersDateTo) {
      labels.push(`Até: ${formatFilterDateLabel(ordersDateTo)}`);
    }
    for (const tag of ordersTagFilter) {
      labels.push(`Tag: ${formatMlOrderTagLabel(tag)}`);
    }
    return labels;
  }, [ordersSearch, ordersStatusFilter, ordersDateFrom, ordersDateTo, ordersTagFilter]);

  const syncOrdersFiltersDraftFromApplied = useCallback(() => {
    setDraftOrdersSearch(ordersSearch);
    setDraftOrdersStatusFilter(ordersStatusFilter);
    setDraftOrdersDateFrom(ordersDateFrom);
    setDraftOrdersDateTo(ordersDateTo);
    setDraftOrdersTagFilter(ordersTagFilter);
  }, [ordersSearch, ordersStatusFilter, ordersDateFrom, ordersDateTo, ordersTagFilter]);

  const handleOrdersFiltersApply = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const from = draftOrdersDateFrom.trim();
      const to = draftOrdersDateTo.trim();
      if (from && to && from > to) {
        alert("A data inicial não pode ser posterior à data final.");
        return;
      }
      setOrdersSearch(draftOrdersSearch.trim());
      setOrdersStatusFilter(draftOrdersStatusFilter);
      setOrdersDateFrom(from);
      setOrdersDateTo(to);
      setOrdersTagFilter(draftOrdersTagFilter);
      setOrdersPage(1);
      setOrdersFiltersModalOpen(false);
    },
    [
      draftOrdersSearch,
      draftOrdersStatusFilter,
      draftOrdersDateFrom,
      draftOrdersDateTo,
      draftOrdersTagFilter,
    ]
  );

  const toggleDraftOrderTag = useCallback((tag: string) => {
    setDraftOrdersTagFilter((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const clearOrdersFilters = useCallback(() => {
    setOrdersSearch("");
    setDraftOrdersSearch("");
    setOrdersStatusFilter("");
    setDraftOrdersStatusFilter("");
    setOrdersDateFrom("");
    setOrdersDateTo("");
    setDraftOrdersDateFrom("");
    setDraftOrdersDateTo("");
    setOrdersTagFilter([]);
    setDraftOrdersTagFilter([]);
    setOrdersPage(1);
    setOrdersFiltersModalOpen(false);
  }, []);

  useEffect(() => {
    setOrdersPage(1);
  }, [
    ordersSearch,
    ordersStatusFilter,
    ordersDateFrom,
    ordersDateTo,
    ordersTagFilter,
    ordersPageSize,
  ]);

  useEffect(() => {
    if (ordersPage > ordersTotalPages) setOrdersPage(Math.max(1, ordersTotalPages));
  }, [ordersPage, ordersTotalPages]);

  const syncBadge = syncStatusBadge(syncState?.initial_backfill_status);
  const loaderOpen = loading || backfilling || syncingPending;
  const loaderMessages = backfilling
    ? ["Carga inicial de vendas (30 dias)…", "Consultando pedidos pagos no Mercado Livre…", "Gravando pedidos e atualizando Preços…"]
    : syncingPending
      ? ["Reprocessando webhooks orders_v2…", "Buscando pedidos no ML e gravando no banco…"]
      : ["Carregando vendas do banco…"];

  return (
    <div className="adminty-vendas-page space-y-5">
      <div className="table-page-shell">
        <SmartLoaderOverlay open={loaderOpen} messages={loaderMessages} />

        <div className="table-page-toolbar">
          <div className="flex flex-wrap items-end gap-1">
            <button
              type="button"
              onClick={() => setTab("vendas")}
              className={
                tab === "vendas"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Vendas
            </button>
            <button
              type="button"
              onClick={() => setTab("resumo")}
              className={
                tab === "resumo"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Resumo 30d
            </button>
            <button
              type="button"
              onClick={() => setTab("como-funciona")}
              className={
                tab === "como-funciona"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Como funciona?
            </button>
          </div>
        </div>

        {tab === "como-funciona" && (
          <div className="table-page-filters">
            <VendasHelpContent />
          </div>
        )}

        {tab !== "como-funciona" && (
          <>
            <div className="border-b border-slate-100 px-3 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={loading || backfilling || syncingPending}
                  className="btn btn-secondary btn-sm disabled:cursor-not-allowed"
                >
                  {loading ? "Atualizando…" : "Atualizar"}
                </button>
                {IS_NEXT_DEV && (
                  <>
                    <button
                      type="button"
                      onClick={() => void runSyncPendingWebhooks()}
                      disabled={loading || backfilling || syncingPending}
                      className="btn btn-secondary btn-sm disabled:cursor-not-allowed"
                      title="Busca no ML pedidos de webhooks orders_v2 que ainda não estão em ml_orders"
                    >
                      {syncingPending ? "Reprocessando…" : "Sincronizar webhooks pendentes"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runBackfill()}
                      disabled={loading || backfilling || syncingPending}
                      className="btn btn-primary btn-sm disabled:cursor-not-allowed"
                    >
                      {backfilling ? "Carga inicial…" : "Carga inicial 30 dias"}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="pricing-filter-bar">
              <div className="pricing-filter-bar-meta flex min-w-0 flex-wrap items-center gap-2 text-[12px]">
                <span className="pricing-filter-bar-label">Status:</span>
                <span
                  className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${syncBadge.className}`}
                >
                  {syncBadge.label}
                </span>
                {hasAggregate && (
                  <span className="table-mini-control">
                    Resumo 30d disponível
                  </span>
                )}
                {syncState?.last_webhook_sync_at && (
                  <span className="text-[11px] text-slate-500">
                    Último webhook:{" "}
                    {new Date(syncState.last_webhook_sync_at).toLocaleString("pt-BR")}
                  </span>
                )}
              </div>
            </div>

            {error && (
              <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
                {error}
              </div>
            )}

            {syncState?.initial_backfill_error && (
              <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
                {syncState.initial_backfill_error}
              </div>
            )}

            {tab === "resumo" && (
              <div className="pricing-table-with-sticky adminty-table-card">
                <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-700">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{aggregate.length}</span>
                    {aggregate.length === 1 ? " anúncio com vendas" : " anúncios com vendas"} nos últimos 30 dias
                    <span className="text-slate-500"> · mesmo critério da coluna Vendas 30d em Preços</span>
                  </p>
                </div>
                <AppTable
                  className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
                  maxHeight="70vh"
                >
                  <AppTableHead>
                    <AppTableHeadRow>
                      <AppTableTh>MLB</AppTableTh>
                      <AppTableTh className="text-right">Pedidos (30d)</AppTableTh>
                      <AppTableTh className="text-right">Unidades (30d)</AppTableTh>
                    </AppTableHeadRow>
                  </AppTableHead>
                  <tbody>
                    {aggregate.length === 0 && !loading ? (
                      <tr>
                        <td colSpan={3} className="p-6 text-center text-sm text-slate-500">
                          Sem vendas no banco. Novos pedidos aparecem automaticamente via sincronização do Mercado Livre.
                        </td>
                      </tr>
                    ) : (
                      aggregate.map((row) => (
                        <AppTableBodyRow key={row.item_id}>
                          <AppTableTd className="font-mono text-xs">{row.item_id}</AppTableTd>
                          <AppTableTd className="text-right tabular-nums">{row.order_count}</AppTableTd>
                          <AppTableTd className="text-right tabular-nums">{row.quantity}</AppTableTd>
                        </AppTableBodyRow>
                      ))
                    )}
                  </tbody>
                </AppTable>
              </div>
            )}

            {tab === "vendas" && (
              <>
                <div className="pricing-filter-bar">
                  <div className="pricing-filter-bar-meta flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[12px]">
                    <span className="pricing-filter-bar-label">Filtros:</span>
                    {appliedOrdersFilters.length > 0 ? (
                      appliedOrdersFilters.map((label, idx) => (
                        <span key={`${idx}-${label}`} className="table-mini-control">
                          {label}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">Nenhum filtro aplicado</span>
                    )}
                    {appliedOrdersFilters.length > 0 && (
                      <button
                        type="button"
                        onClick={() => clearOrdersFilters()}
                        className="text-[11px] font-semibold text-[#0d6efd] hover:underline"
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      syncOrdersFiltersDraftFromApplied();
                      setOrdersFiltersModalOpen(true);
                    }}
                    className="btn btn-icon btn-sm btn-outline-secondary"
                    title="Abrir filtros"
                    aria-label="Abrir filtros"
                  >
                    <FilterIcon />
                  </button>
                </div>

                <div className="pricing-table-with-sticky adminty-table-card">
                <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-700">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-medium text-slate-800 dark:text-slate-100">
                      {paginatedOrderLines.length}
                    </span>
                    {paginatedOrderLines.length === 1 ? " linha nesta página" : " linhas nesta página"}
                    <span className="text-slate-500">
                      {" "}
                      ·{" "}
                      <span className="font-medium text-slate-800 dark:text-slate-100">
                        {filteredOrderLines.length}
                      </span>
                      {filteredOrderLines.length === 1 ? " linha filtrada" : " linhas filtradas"}
                      {" · "}
                      <span className="font-medium text-slate-800 dark:text-slate-100">{orders.length}</span>
                      {orders.length === 1 ? " pedido" : " pedidos"} carregados
                      {orders.length >= SALES_ORDERS_FETCH_LIMIT && (
                        <span className="text-amber-700 dark:text-amber-400">
                          {" "}
                          (limite de {SALES_ORDERS_FETCH_LIMIT})
                        </span>
                      )}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <TablePageSizeSelect
                      value={ordersPageSize}
                      options={ORDERS_PAGE_SIZE_OPTIONS}
                      showAllOption
                      onChange={(next) => {
                        setOrdersPageSize(next);
                        setOrdersPage(1);
                      }}
                    />
                    {ordersTotalPages > 1 && (
                      <>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          Página {ordersPage}/{ordersTotalPages}
                        </span>
                        <div className="table-pagination-group">
                          <button
                            type="button"
                            onClick={() => setOrdersPage(1)}
                            disabled={ordersPage === 1}
                            className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                            title="Primeira página"
                          >
                            «
                          </button>
                          <button
                            type="button"
                            onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                            disabled={ordersPage <= 1}
                            className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            Anterior
                          </button>
                          <span className="min-w-[2ch] px-1.5 py-0.5 text-center font-semibold text-slate-800 dark:text-slate-100">
                            {ordersPage}
                          </span>
                          <button
                            type="button"
                            onClick={() => setOrdersPage((p) => Math.min(ordersTotalPages, p + 1))}
                            disabled={ordersPage >= ordersTotalPages}
                            className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            Próxima
                          </button>
                          <button
                            type="button"
                            onClick={() => setOrdersPage(ordersTotalPages)}
                            disabled={ordersPage === ordersTotalPages}
                            className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                            title="Última página"
                          >
                            »
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {profitCalcNote && (
                  <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-100">
                    {profitCalcNote}
                  </div>
                )}
                <AppTable
                  className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
                  maxHeight="70vh"
                >
                  <AppTableHead>
                    <AppTableHeadRow>
                      <AppTableTh>Pedido</AppTableTh>
                      <AppTableTh>Status</AppTableTh>
                      <AppTableTh title="Tags do pedido no ML (order.tags)">Tags ML</AppTableTh>
                      <AppTableTh>Data</AppTableTh>
                      <AppTableTh>MLB</AppTableTh>
                      <AppTableTh>SKU</AppTableTh>
                      <AppTableTh className="text-right">Qtd</AppTableTh>
                      <AppTableTh className="text-right">Preço</AppTableTh>
                      <AppTableTh className="text-right" title="sale_fee do pedido vs % referência">
                        Taxa ML
                      </AppTableTh>
                      <AppTableTh className="text-right" title="senders[].cost do envio vs tabela">
                        Frete
                      </AppTableTh>
                      <AppTableTh className="text-right">Lucro</AppTableTh>
                    </AppTableHeadRow>
                  </AppTableHead>
                  <tbody>
                    {filteredOrderLines.length === 0 && !loading ? (
                      <tr>
                        <td colSpan={11} className="p-6 text-center text-sm text-slate-500">
                          {orderLineTableRows.length === 0
                            ? "Nenhum pedido gravado ainda."
                            : "Nenhuma linha corresponde aos filtros."}
                        </td>
                      </tr>
                    ) : (
                      paginatedOrderLines.map((row) => {
                        const badge = orderStatusBadge(row.status);
                        const qty = row.quantity > 0 ? row.quantity : 1;
                        const lineFeeEst =
                          row.fee != null ? Math.round(row.fee * qty * 100) / 100 : null;
                        const lineShipEst =
                          row.shipping_cost != null
                            ? Math.round(row.shipping_cost * qty * 100) / 100
                            : null;
                        const rowKey = `${row.ml_order_id}-${row.line_index}-${row.item_id}`;
                        return (
                          <AppTableBodyRow key={rowKey}>
                            <AppTableTd className="font-mono text-xs">
                              <CopyableCell
                                value={row.ml_order_id}
                                cellId={`${rowKey}-order`}
                                copiedCell={copiedCell}
                                onCopy={copyToClipboard}
                                className="font-mono text-xs"
                                display={<>#{row.ml_order_id}</>}
                              />
                            </AppTableTd>
                            <AppTableTd>
                              <span
                                className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </AppTableTd>
                            <AppTableTd className="align-top text-xs">
                              <OrderTagsBadges tags={row.tags} />
                            </AppTableTd>
                            <AppTableTd className="whitespace-nowrap text-xs text-slate-600">
                              {new Date(row.date_created).toLocaleString("pt-BR")}
                            </AppTableTd>
                            <AppTableTd className="font-mono text-xs">
                              <CopyableCell
                                value={row.item_id}
                                cellId={`${rowKey}-mlb`}
                                copiedCell={copiedCell}
                                onCopy={copyToClipboard}
                                className="font-mono text-xs"
                              />
                            </AppTableTd>
                            <AppTableTd className="text-xs text-slate-700 dark:text-slate-300">
                              <CopyableCell
                                value={row.sku ?? ""}
                                cellId={`${rowKey}-sku`}
                                copiedCell={copiedCell}
                                onCopy={copyToClipboard}
                                className="max-w-full truncate text-xs text-slate-700 dark:text-slate-300"
                              />
                            </AppTableTd>
                            <AppTableTd className="text-right tabular-nums text-sm">{row.quantity}</AppTableTd>
                            <AppTableTd className="text-right text-sm tabular-nums">
                              {row.sale_price != null ? (
                                <>R$ {formatBRL(row.sale_price)}</>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </AppTableTd>
                            <AppTableTd className="text-right text-sm">
                              <CompareValueCell
                                labelReal="Real"
                                labelEst="Est."
                                real={row.fee_ml}
                                estimated={lineFeeEst}
                                realTitle="order_items[].sale_fee (comissão ML na venda)"
                                estTitle="Taxa estimada (% referência × preço)"
                              />
                            </AppTableTd>
                            <AppTableTd className="text-right text-sm">
                              <CompareValueCell
                                labelReal="Real"
                                labelEst="Est."
                                real={row.shipping_ml}
                                estimated={lineShipEst}
                                realTitle="Frete do vendedor: GET /shipments/{id}/costs → senders[].cost"
                                estTitle="Frete estimado (tabela Mercado Líder)"
                              />
                            </AppTableTd>
                            <AppTableTd className="text-right text-sm">
                              {row.line_profit_ml != null || row.line_profit != null ? (
                                <div className="flex flex-col items-end gap-1">
                                  <CompareValueCell
                                    labelReal="Real"
                                    labelEst="Est."
                                    real={row.line_profit_ml}
                                    estimated={row.line_profit}
                                    realTitle={
                                      row.ml_data_error ??
                                      "Lucro com taxa/frete reais do ML + custo do produto"
                                    }
                                    estTitle={row.profit_error ?? "Lucro com taxa/frete estimados"}
                                  />
                                  {row.profit_percent_ml != null && (
                                    <span className="text-[10px] text-slate-500">
                                      real {row.profit_percent_ml >= 0 ? "+" : ""}
                                      {row.profit_percent_ml.toFixed(1)}%
                                      {row.profit_percent != null && (
                                        <>
                                          {" "}
                                          · est. {row.profit_percent >= 0 ? "+" : ""}
                                          {row.profit_percent.toFixed(1)}%
                                        </>
                                      )}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span
                                  className="text-xs text-slate-400"
                                  title={
                                    row.ml_data_error ??
                                    row.profit_error ??
                                    "Vincule produto e resincronize pedidos"
                                  }
                                >
                                  {row.ml_data_error ?? row.profit_error ?? "—"}
                                </span>
                              )}
                            </AppTableTd>
                          </AppTableBodyRow>
                        );
                      })
                    )}
                  </tbody>
                </AppTable>
              </div>
              </>
            )}
          </>
        )}
      </div>

      {ordersFiltersModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOrdersFiltersModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Filtros de vendas"
        >
          <div className="modal-panel-scroll" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div>
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">Filtros</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Refine por pedido, MLB, SKU, status, tags do ML e intervalo de datas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOrdersFiltersModalOpen(false)}
                className="rounded border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:border-slate-600 dark:hover:bg-slate-800"
                aria-label="Fechar filtros"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleOrdersFiltersApply} className="space-y-4 p-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Buscar
                </label>
                <input
                  type="text"
                  value={draftOrdersSearch}
                  onChange={(e) => setDraftOrdersSearch(e.target.value)}
                  placeholder="Pedido, MLB ou SKU…"
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Status do pedido
                </label>
                <select
                  value={draftOrdersStatusFilter}
                  onChange={(e) => setDraftOrdersStatusFilter(e.target.value as OrderStatusFilter)}
                  className="input text-xs font-medium"
                >
                  <option value="">Todos</option>
                  <option value="paid">Pago</option>
                  <option value="cancelled">Cancelado</option>
                  <option value="other">Outros</option>
                </select>
              </div>
              <div>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Período (data do pedido)
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">De</label>
                    <input
                      type="date"
                      value={draftOrdersDateFrom}
                      onChange={(e) => setDraftOrdersDateFrom(e.target.value)}
                      className="input w-full py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Até</label>
                    <input
                      type="date"
                      value={draftOrdersDateTo}
                      onChange={(e) => setDraftOrdersDateTo(e.target.value)}
                      min={draftOrdersDateFrom || undefined}
                      className="input w-full py-2 text-sm"
                    />
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Deixe em branco para não limitar por data. Pode usar só &quot;De&quot; ou só &quot;Até&quot;.
                </p>
              </div>
              <div>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Tags do Mercado Livre
                </span>
                <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                  Mostra pedidos que tenham <strong>qualquer uma</strong> das tags selecionadas (
                  <code className="text-[10px]">order.tags</code>).
                </p>
                {availableOrderTags.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Nenhuma tag nos pedidos carregados. Sincronize vendas ou use &quot;Atualizar&quot;.
                  </p>
                ) : (
                  <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                    {availableOrderTags.map((tag) => (
                      <label
                        key={tag}
                        className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                          draftOrdersTagFilter.includes(tag)
                            ? "border-[#0d6efd] bg-[#0d6efd]/10 text-[#0d6efd]"
                            : "border-slate-200 bg-card text-slate-700 dark:border-slate-600 dark:text-slate-200"
                        }`}
                        title={tag}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={draftOrdersTagFilter.includes(tag)}
                          onChange={() => toggleDraftOrderTag(tag)}
                        />
                        {formatMlOrderTagLabel(tag)}
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-slate-700">
                <button type="button" onClick={() => clearOrdersFilters()} className="btn btn-secondary btn-sm">
                  Limpar filtros
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Aplicar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VendasPage() {
  return (
    <OnboardingGate required="catalog">
      <VendasPageContent />
    </OnboardingGate>
  );
}
