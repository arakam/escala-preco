"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notFound } from "next/navigation";
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

const IS_DEV = process.env.NODE_ENV === "development";

type VendasTab = "agregado" | "pedidos" | "como-funciona";

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
};

type ItemRow = {
  ml_order_id: string;
  item_id: string;
  quantity: number;
  unit_price: number | null;
  line_index: number;
};

type AggRow = {
  item_id: string;
  order_count: number;
  quantity: number;
};

type OrderTableRow = OrderRow & {
  items_summary: string;
  item_count: number;
};

function VendasHelpContent() {
  return (
    <div className="space-y-4 text-sm text-fg">
      <h2 className="text-lg font-semibold text-fg-strong">Vendas ML (desenvolvimento)</h2>
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
            <strong>Carga inicial 30 dias</strong> — busca pedidos pagos no ML e grava no banco (só em dev).
          </li>
          <li>
            <strong>Webhooks</strong> (<code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">orders_v2</code>) — cada pedido novo ou
            alterado atualiza o banco e recalcula <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">pricing_cache.orders_30d</code>{" "}
            dos MLB do pedido.
          </li>
          <li>
            A aba <strong>Agregado 30d</strong> mostra o mesmo critério da coluna Preços: pedidos pagos nos últimos 30 dias por MLB.
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

function DevVendasPageContent() {
  const [tab, setTab] = useState<VendasTab>("agregado");
  const [loading, setLoading] = useState(true);
  const [backfilling, setBackfilling] = useState(false);
  const [syncingPending, setSyncingPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [aggregate, setAggregate] = useState<AggRow[]>([]);
  const [hasAggregate, setHasAggregate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/sales?limit=80", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Falha ao carregar");
        return;
      }
      setSyncState(data.sync_state ?? null);
      setOrders(data.recent_orders ?? []);
      setItems(data.order_items ?? []);
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

  const itemsByOrder = useMemo(() => {
    const map = new Map<string, ItemRow[]>();
    for (const it of items) {
      const list = map.get(it.ml_order_id) ?? [];
      list.push(it);
      map.set(it.ml_order_id, list);
    }
    return map;
  }, [items]);

  const orderTableRows: OrderTableRow[] = useMemo(() => {
    return orders.map((o) => {
      const lines = itemsByOrder.get(o.ml_order_id) ?? [];
      const items_summary = lines.map((it) => `${it.item_id} × ${it.quantity}`).join(" · ");
      return {
        ...o,
        items_summary: items_summary || "—",
        item_count: lines.length,
      };
    });
  }, [orders, itemsByOrder]);

  const syncBadge = syncStatusBadge(syncState?.initial_backfill_status);
  const loaderOpen = loading || backfilling || syncingPending;
  const loaderMessages = backfilling
    ? ["Carga inicial de vendas (30 dias)…", "Consultando pedidos pagos no Mercado Livre…", "Gravando pedidos e atualizando Preços…"]
    : syncingPending
      ? ["Reprocessando webhooks orders_v2…", "Buscando pedidos no ML e gravando no banco…"]
      : ["Carregando vendas do banco…"];

  return (
    <div className="adminty-vendas-page space-y-5">
      <div className="overflow-hidden rounded border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <SmartLoaderOverlay open={loaderOpen} messages={loaderMessages} />

        <div className="border-b border-amber-200/80 bg-amber-50/90 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
          Ambiente de desenvolvimento — esta tela não aparece em produção.
        </div>

        <div className="border-b border-slate-200 bg-white px-3 pt-3">
          <div className="flex flex-wrap items-end gap-1">
            <button
              type="button"
              onClick={() => setTab("agregado")}
              className={
                tab === "agregado"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Agregado 30d
            </button>
            <button
              type="button"
              onClick={() => setTab("pedidos")}
              className={
                tab === "pedidos"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Pedidos
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
          <div className="max-h-[min(70vh,720px)] overflow-y-auto border-b border-slate-100 bg-white px-4 py-4 dark:bg-slate-900/20">
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
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12px] text-slate-600">
                <span className="font-semibold text-slate-700 dark:text-slate-200">Status:</span>
                <span
                  className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${syncBadge.className}`}
                >
                  {syncBadge.label}
                </span>
                {hasAggregate && (
                  <span className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                    Agregado 30d disponível
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

            {tab === "agregado" && (
              <div className="pricing-table-with-sticky adminty-table-card">
                <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
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
                          Sem vendas no banco. Use <strong>Carga inicial 30 dias</strong> ou aguarde webhooks de pedidos.
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

            {tab === "pedidos" && (
              <div className="pricing-table-with-sticky adminty-table-card">
                <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{orderTableRows.length}</span>
                    {orderTableRows.length === 1 ? " pedido recente" : " pedidos recentes"} no banco
                  </p>
                </div>
                <AppTable
                  className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
                  maxHeight="70vh"
                >
                  <AppTableHead>
                    <AppTableHeadRow>
                      <AppTableTh>Pedido</AppTableTh>
                      <AppTableTh>Status</AppTableTh>
                      <AppTableTh>Data</AppTableTh>
                      <AppTableTh className="min-w-[14rem]">Itens (MLB)</AppTableTh>
                    </AppTableHeadRow>
                  </AppTableHead>
                  <tbody>
                    {orderTableRows.length === 0 && !loading ? (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-sm text-slate-500">
                          Nenhum pedido gravado ainda.
                        </td>
                      </tr>
                    ) : (
                      orderTableRows.map((o) => {
                        const badge = orderStatusBadge(o.status);
                        return (
                          <AppTableBodyRow key={o.ml_order_id}>
                            <AppTableTd className="font-mono text-xs">#{o.ml_order_id}</AppTableTd>
                            <AppTableTd>
                              <span
                                className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            </AppTableTd>
                            <AppTableTd className="whitespace-nowrap text-xs text-slate-600">
                              {new Date(o.date_created).toLocaleString("pt-BR")}
                            </AppTableTd>
                            <AppTableTd className="text-xs text-slate-700 dark:text-slate-300" title={o.items_summary}>
                              {o.items_summary}
                            </AppTableTd>
                          </AppTableBodyRow>
                        );
                      })
                    )}
                  </tbody>
                </AppTable>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function DevVendasPage() {
  if (!IS_DEV) notFound();

  return (
    <OnboardingGate required="catalog">
      <DevVendasPageContent />
    </OnboardingGate>
  );
}
