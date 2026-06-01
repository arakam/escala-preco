"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
import { summarizeRecebimentoRows } from "@/lib/recebimento/summarize";
import type {
  RecebimentoApiMeta,
  RecebimentoDaySummary,
  RecebimentoReleaseStatus,
  RecebimentoRow,
} from "@/lib/recebimento/types";

type ViewMode = "release-day" | "all" | "help";
type ReleaseFilter = "" | RecebimentoReleaseStatus;

function formatBRL(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatReleaseDateLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return iso;
  const today = todayIsoDate();
  const base = d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return iso === today ? `hoje (${base})` : base;
}

function releaseStatusBadge(status: RecebimentoReleaseStatus): { label: string; className: string } {
  if (status === "released") {
    return {
      label: "Liberado",
      className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    };
  }
  if (status === "scheduled") {
    return {
      label: "Previsto",
      className: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    };
  }
  return {
    label: "Pendente",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  };
}

function paymentMethodLabel(method: string, type: string): string {
  const m = method.toUpperCase();
  if (m === "PIX") return "Pix";
  if (m === "MASTER" || m === "VISA") return `Cartão ${m[0]}${m.slice(1).toLowerCase()}`;
  if (m === "ACCOUNT_MONEY") return "Saldo MP";
  if (type === "ticket") return "Boleto";
  return method;
}

function matchesReleaseDay(row: RecebimentoRow, isoDate: string): boolean {
  const t = new Date(row.money_release_date).getTime();
  const start = new Date(`${isoDate}T00:00:00`).getTime();
  const end = new Date(`${isoDate}T23:59:59.999`).getTime();
  return t >= start && t <= end;
}

function SummaryCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: "emerald" | "sky" | "amber" | "slate";
}) {
  const accentBorder =
    accent === "emerald"
      ? "border-emerald-200 dark:border-emerald-800"
      : accent === "sky"
        ? "border-sky-200 dark:border-sky-800"
        : accent === "amber"
          ? "border-amber-200 dark:border-amber-800"
          : "border-stroke dark:border-slate-700";

  return (
    <div className={`rounded-lg border bg-card p-4 shadow-sm ${accentBorder}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-fg-strong">R$ {value}</p>
      <p className="mt-1 text-xs text-secondary">{hint}</p>
    </div>
  );
}

function ReceberNoDiaHero({
  summary,
  releaseDate,
  isToday,
}: {
  summary: RecebimentoDaySummary;
  releaseDate: string;
  isToday: boolean;
}) {
  return (
    <div className="rounded-xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm dark:border-emerald-800 dark:from-emerald-950/50 dark:to-slate-900">
      <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
        {isToday ? "O que você tem para receber hoje" : "Total na data de liberação"}
      </p>
      <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-200/70">
        Crédito previsto no Mercado Pago em{" "}
        <strong className="font-medium">{formatReleaseDateLabel(releaseDate)}</strong>
        {" "}
        — filtro pela coluna <em>Liberação</em>
      </p>
      <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight text-fg-strong">
        R$ {formatBRL(summary.total_net)}
      </p>
      <p className="mt-2 text-sm text-secondary">
        {summary.row_count} pedido(s) com liberação neste dia
        {summary.scheduled_total > 0 ? (
          <>
            {" "}
            · <span className="text-sky-700 dark:text-sky-300">R$ {formatBRL(summary.scheduled_total)} ainda previsto</span>
          </>
        ) : null}
        {summary.released_total > 0 ? (
          <>
            {" "}
            · <span className="text-emerald-700 dark:text-emerald-300">R$ {formatBRL(summary.released_total)} já liberado</span>
          </>
        ) : null}
      </p>
    </div>
  );
}

function dataSourceBadgeClass(source: RecebimentoRow["data_source"]): string {
  if (source === "billing") {
    return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200";
  }
  if (source === "mixed") {
    return "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200";
  }
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

function RecebimentoHelpContent() {
  return (
    <div className="space-y-4 text-sm text-fg">
      <h2 className="text-lg font-semibold text-fg-strong">Recebimento — dev</h2>
      <section>
        <h3 className="mb-2 font-medium text-fg-strong">Objetivo</h3>
        <p>
          Visualizar, por pedido, o valor líquido a receber e quando o dinheiro libera — cruzando dados do
          Mercado Livre (pedido, taxas, frete) com faturamento/billing e, no futuro, conciliação Mercado Pago.
        </p>
      </section>
      <section>
        <h3 className="mb-2 font-medium text-fg-strong">Fontes usadas</h3>
        <ul className="list-inside list-disc space-y-1">
          <li>
            Pedidos pagos persistidos em <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">ml_orders</code> /{" "}
            <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">ml_order_items</code>
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">
              GET /billing/integration/group/ML/order/details
            </code>{" "}
            — <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">money_release_date</code>,{" "}
            <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">sale_fee</code> (gross/net/rebate),{" "}
            impostos
          </li>
          <li>
            <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">GET /shipments/&#123;id&#125;/costs</code>{" "}
            — frete do vendedor
          </li>
          <li>
            Use <strong>Buscar faltantes no ML (35 dias)</strong> para trazer pedidos pagos que ainda não estão no banco
            (via <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">orders/search</code>), sem
            regravar os que já existem.
          </li>
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-medium text-fg-strong">Como filtrar</h3>
        <ul className="list-inside list-disc space-y-1">
          <li>
            Use <strong>Receber hoje</strong> para ver só pedidos cuja <strong>data de liberação</strong> é o dia
            atual (campo do billing / Mercado Pago).
          </li>
          <li>
            Em <strong>Outra data</strong>, escolha o dia no calendário — o total e a tabela mostram só o que libera
            naquele dia.
          </li>
          <li>
            O filtro <strong>Status</strong> separa o que ainda vai entrar (<em>Previsto</em>) do que já caiu no saldo (
            <em>Liberado</em>).
          </li>
        </ul>
      </section>
      <section>
        <h3 className="mb-2 font-medium text-fg-strong">Colunas da tabela</h3>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong>Líquido</strong> = bruto − taxa líquida − frete − impostos + subsídio ML (rebate), alinhado ao
            “Vai receber” das outras telas.
          </li>
          <li>
            <strong>Liberação</strong> vem do billing (<code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">money_release_date</code>
            ).
          </li>
          <li>
            <strong>Fonte</strong>: <em>orders</em> (só pedido), <em>billing</em> (faturamento ML) ou <em>mixed</em> (ambos).
          </li>
        </ul>
      </section>
      <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
        Se o billing retornar 403, a tela ainda monta linhas com dados do pedido (<code className="text-xs">GET /orders</code>
        ). Liberação e subsídios podem ficar incompletos até a conta ter acesso ao faturamento ML.
      </p>
    </div>
  );
}

export function RecebimentoDevPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("release-day");
  const [releaseDate, setReleaseDate] = useState(todayIsoDate);
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("");
  const [search, setSearch] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [allRows, setAllRows] = useState<RecebimentoRow[]>([]);
  const [meta, setMeta] = useState<RecebimentoApiMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncBanner, setSyncBanner] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date: releaseDate, limit: "120" });
      const res = await fetch(`/api/dev/recebimento?${params.toString()}`);
      const data = (await res.json()) as {
        error?: string;
        rows?: RecebimentoRow[];
        meta?: RecebimentoApiMeta;
      };
      if (!res.ok) {
        setError(data.error ?? "Erro ao carregar recebimentos");
        setAllRows([]);
        setMeta(null);
        return;
      }
      setAllRows(data.rows ?? []);
      setMeta(data.meta ?? null);
    } catch {
      setError("Falha de rede ao carregar recebimentos");
      setAllRows([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [releaseDate]);

  const today = todayIsoDate();
  const viewingToday = releaseDate === today;

  const syncMissingFromMl = useCallback(async () => {
    setSyncLoading(true);
    setSyncBanner(null);
    try {
      const res = await fetch("/api/dev/recebimento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 35 }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        synced?: number;
        skipped_existing?: number;
        scanned?: number;
        items_upserted?: number;
        shipments_enriched?: number;
        errors?: string[];
      };
      if (!res.ok || data.ok === false) {
        setSyncBanner(data.error ?? "Falha ao sincronizar pedidos");
        return;
      }
      const errs = data.errors?.length ? ` Avisos: ${data.errors.slice(0, 2).join("; ")}` : "";
      setSyncBanner(
        `Novos: ${data.synced ?? 0} · Já no banco: ${data.skipped_existing ?? 0} · Vistos na busca: ${data.scanned ?? 0} · Itens: ${data.items_upserted ?? 0} · Envios: ${data.shipments_enriched ?? 0}.${errs}`
      );
      await loadData();
    } catch {
      setSyncBanner("Erro de rede na sincronização");
    } finally {
      setSyncLoading(false);
    }
  }, [loadData]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const rowsForReleaseDay = useMemo(
    () => allRows.filter((row) => matchesReleaseDay(row, releaseDate)),
    [allRows, releaseDate]
  );

  const summary: RecebimentoDaySummary = useMemo(
    () => summarizeRecebimentoRows(rowsForReleaseDay, releaseDate),
    [rowsForReleaseDay, releaseDate]
  );

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const base = viewMode === "release-day" ? rowsForReleaseDay : allRows;
    return base.filter((row) => {
      if (releaseFilter && row.money_release_status !== releaseFilter) return false;
      if (!term) return true;
      return (
        row.ml_order_id.includes(term) ||
        String(row.payment_id).includes(term) ||
        row.item_title.toLowerCase().includes(term)
      );
    });
  }, [allRows, releaseFilter, rowsForReleaseDay, search, viewMode]);

  const goToToday = () => {
    setViewMode("release-day");
    setReleaseDate(today);
    setReleaseFilter("");
  };

  const viewBtn = (active: boolean, label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-[var(--adminty-accent,#01a9ac)] bg-[var(--adminty-accent,#01a9ac)] text-white"
          : "border-slate-200 bg-card text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <OnboardingGate required="ml">
      <div className="relative space-y-4">
        <SmartLoaderOverlay open={loading || syncLoading} phase="default" />

        <div className="rounded-lg border-2 border-dashed border-violet-300 bg-violet-50/90 px-4 py-3 dark:border-violet-800 dark:bg-violet-950/30">
          <p className="text-sm font-medium text-violet-900 dark:text-violet-100">
            Dev — visível apenas com <code className="text-xs">npm run dev</code>
          </p>
          <p className="mt-1 text-xs text-violet-800/90 dark:text-violet-200/80">
            Dados reais: pedidos do banco +{" "}
            <code className="text-xs">billing/integration/group/ML/order/details</code> + complemento{" "}
            <code className="text-xs">GET /orders</code> quando necessário.
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        {meta?.billing_forbidden ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            Billing ML sem permissão (403). Exibindo fallback via pedidos — liberação e subsídios podem estar
            incompletos.
          </div>
        ) : meta?.billing_error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            Billing parcial: {meta.billing_error}
          </div>
        ) : null}

        {syncBanner ? (
          <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100">
            {syncBanner}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-fg-strong">Recebimento</h1>
            <p className="mt-1 text-sm text-secondary">
              Veja quanto entra no Mercado Pago pela <strong>data de liberação</strong> de cada pedido.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {viewBtn(viewMode === "release-day" && viewingToday, "Receber hoje", goToToday)}
            {viewBtn(viewMode === "release-day" && !viewingToday, "Outra data", () => {
              setViewMode("release-day");
            })}
            {viewBtn(viewMode === "all", "Todos os pedidos", () => setViewMode("all"))}
            {viewBtn(viewMode === "help", "Como funciona", () => setViewMode("help"))}
            {viewMode === "release-day" && !viewingToday ? (
              <button
                type="button"
                onClick={goToToday}
                className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-100"
              >
                Voltar para hoje
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void syncMissingFromMl()}
              disabled={syncLoading || loading}
              className="btn btn-sm btn-primary disabled:opacity-60"
              title="orders/search últimos 35 dias — grava só pedidos que ainda não estão em ml_orders"
            >
              {syncLoading ? "Sincronizando…" : "Buscar faltantes no ML (35 dias)"}
            </button>
            <button
              type="button"
              onClick={() => void loadData()}
              disabled={loading || syncLoading}
              className="btn btn-sm btn-outline-secondary disabled:opacity-60"
            >
              Atualizar
            </button>
          </div>
        </div>

        {viewMode !== "help" && (
          <>
            {viewMode === "release-day" ? (
              <>
                <div className="flex flex-wrap items-end gap-3 rounded-lg border border-stroke bg-card px-4 py-3 dark:border-slate-700">
                  <div>
                    <label
                      htmlFor="recebimento-release-date"
                      className="block text-xs font-medium text-slate-600 dark:text-slate-400"
                    >
                      Data de liberação
                    </label>
                    <input
                      id="recebimento-release-date"
                      type="date"
                      value={releaseDate}
                      onChange={(e) => setReleaseDate(e.target.value)}
                      className="mt-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                    />
                  </div>
                  <p className="max-w-md text-xs text-secondary">
                    Mostramos pedidos cuja coluna <strong>Liberação</strong> cai neste dia. Para saber o que recebe{" "}
                      <strong>hoje</strong>, deixe a data de hoje e use o filtro “Ainda vai entrar” se quiser só o
                      que ainda não caiu no saldo.
                  </p>
                </div>
                <ReceberNoDiaHero summary={summary} releaseDate={releaseDate} isToday={viewingToday} />
              </>
            ) : (
              <p className="rounded-lg border border-stroke bg-card px-4 py-3 text-sm text-secondary dark:border-slate-700">
                Últimos {meta?.orders_loaded ?? "—"} pedidos pagos (35 dias). Use “Receber hoje” para filtrar por data
                de liberação.
              </p>
            )}

            {viewMode === "release-day" ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryCard
                  label="Ainda vai entrar"
                  value={formatBRL(summary.scheduled_total)}
                  hint="Status Previsto — agendado para este dia"
                  accent="sky"
                />
                <SummaryCard
                  label="Já liberado no dia"
                  value={formatBRL(summary.released_total)}
                  hint="Status Liberado — já creditado nesta data"
                  accent="emerald"
                />
                <SummaryCard
                  label="Pendente neste dia"
                  value={formatBRL(summary.pending_total)}
                  hint="Liberação nesta data, mas status ainda pendente"
                  accent="amber"
                />
              </div>
            ) : (
              <SummaryCard
                label="Total líquido (tabela)"
                value={formatBRL(filteredRows.reduce((s, r) => s + r.net_to_receive, 0))}
                hint={`${filteredRows.length} linha(s) — sem filtro por data`}
                accent="slate"
              />
            )}

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-stroke bg-card px-3 py-2 dark:border-slate-700">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Status:</span>
              {(
                [
                  ["", "Todos"],
                  ["scheduled", "Ainda vai entrar"],
                  ["released", "Já liberado"],
                  ["pending", "Pendente"],
                ] as const
              ).map(([value, label]) => {
                const active = releaseFilter === value;
                return (
                  <button
                    key={value || "all"}
                    type="button"
                    onClick={() => setReleaseFilter(value)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      active
                        ? "border-[var(--adminty-accent,#01a9ac)] bg-[var(--adminty-accent,#01a9ac)] text-white"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
              <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block dark:bg-slate-600" />
              <input
                type="search"
                placeholder="Buscar pedido, pagamento ou título…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="min-w-[12rem] flex-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
            </div>

            <AppTable
              summary={
                viewMode === "release-day"
                  ? `${filteredRows.length} de ${summary.row_count} pedido(s) com liberação em ${new Date(`${releaseDate}T12:00:00`).toLocaleDateString("pt-BR")}${
                      meta ? ` · ${meta.orders_loaded} pedidos carregados (35 dias)` : ""
                    }`
                  : meta
                    ? `${filteredRows.length} pedido(s) — ${meta.orders_loaded} carregados, ${meta.orders_from_api} via GET /orders`
                    : `${filteredRows.length} pedido(s)`
              }
              maxHeight="65vh"
            >
              <AppTableHead>
                <AppTableHeadRow>
                  <AppTableTh>Pedido ML</AppTableTh>
                  <AppTableTh>Pagamento</AppTableTh>
                  <AppTableTh>Meio</AppTableTh>
                  <AppTableTh className="text-right">Bruto</AppTableTh>
                  <AppTableTh className="text-right" title="Comissão bruta / líquida / subsídio ML">
                    Taxa ML
                  </AppTableTh>
                  <AppTableTh className="text-right">Frete</AppTableTh>
                  <AppTableTh className="text-right">Impostos</AppTableTh>
                  <AppTableTh className="text-right">Líquido</AppTableTh>
                  <AppTableTh>Liberação</AppTableTh>
                  <AppTableTh>Fonte</AppTableTh>
                </AppTableHeadRow>
              </AppTableHead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">
                      {viewMode === "release-day" ? (
                        <>
                          Nenhum pedido com liberação em{" "}
                          {new Date(`${releaseDate}T12:00:00`).toLocaleDateString("pt-BR")}.
                          {viewingToday ? " Tente “Todos os pedidos” ou sincronize faltantes no ML." : null}
                        </>
                      ) : (
                        "Nenhum registro para os filtros selecionados."
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const badge = releaseStatusBadge(row.money_release_status);
                    const expanded = expandedOrderId === row.ml_order_id;
                    return (
                      <Fragment key={row.ml_order_id}>
                        <AppTableBodyRow
                          className="cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
                          onClick={() =>
                            setExpandedOrderId(expanded ? null : row.ml_order_id)
                          }
                        >
                          <AppTableTd>
                            <div className="font-mono text-xs text-fg-strong">{row.ml_order_id}</div>
                            <div className="mt-0.5 max-w-[14rem] truncate text-[11px] text-slate-500" title={row.item_title}>
                              {row.item_title}
                            </div>
                          </AppTableTd>
                          <AppTableTd>
                            <div className="font-mono text-xs">
                              {row.payment_id > 0 ? row.payment_id : "—"}
                            </div>
                            <div className="mt-0.5 text-[10px] text-slate-500">
                              {row.payment_status}
                              {row.payment_status_detail ? ` · ${row.payment_status_detail}` : ""}
                            </div>
                          </AppTableTd>
                          <AppTableTd className="text-xs">
                            {paymentMethodLabel(row.payment_method_id, row.payment_type_id)}
                            {row.installments > 1 ? (
                              <span className="ml-1 text-slate-400">({row.installments}x)</span>
                            ) : null}
                          </AppTableTd>
                          <AppTableTd className="text-right tabular-nums">
                            R$ {formatBRL(row.transaction_amount)}
                            {row.coupon_amount > 0 ? (
                              <div className="text-[10px] text-emerald-600">− cupom {formatBRL(row.coupon_amount)}</div>
                            ) : null}
                          </AppTableTd>
                          <AppTableTd className="text-right text-xs tabular-nums">
                            <div title="Bruta">{formatBRL(row.marketplace_fee_gross)}</div>
                            <div className="text-slate-600 dark:text-slate-400" title="Líquida">
                              → {formatBRL(row.marketplace_fee_net)}
                            </div>
                            {row.marketplace_fee_rebate > 0 ? (
                              <div className="text-emerald-600" title="Subsídio ML">
                                +{formatBRL(row.marketplace_fee_rebate)}
                              </div>
                            ) : null}
                          </AppTableTd>
                          <AppTableTd className="text-right tabular-nums">
                            {row.shipping_cost > 0 ? `R$ ${formatBRL(row.shipping_cost)}` : "—"}
                          </AppTableTd>
                          <AppTableTd className="text-right tabular-nums">
                            {row.taxes_amount > 0 ? `R$ ${formatBRL(row.taxes_amount)}` : "—"}
                          </AppTableTd>
                          <AppTableTd className="text-right font-medium tabular-nums text-fg-strong">
                            R$ {formatBRL(row.net_to_receive)}
                          </AppTableTd>
                          <AppTableTd>
                            <span
                              className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                              {formatDateTime(row.money_release_date)}
                            </div>
                            {row.money_release_days > 0 ? (
                              <div className="text-[10px] text-slate-400">{row.money_release_days}d prazo</div>
                            ) : null}
                          </AppTableTd>
                          <AppTableTd>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${dataSourceBadgeClass(row.data_source)}`}
                            >
                              {row.data_source}
                            </span>
                          </AppTableTd>
                        </AppTableBodyRow>
                        {expanded ? (
                          <tr className="bg-slate-50/60 dark:bg-slate-900/40">
                            <td colSpan={10} className="border-t border-stroke px-4 py-3 text-xs dark:border-slate-700">
                              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                <div>
                                  <p className="font-medium text-fg-strong">Pagamento (orders / collections)</p>
                                  <ul className="mt-1 space-y-0.5 text-slate-600 dark:text-slate-400">
                                    <li>Aprovado: {formatDateTime(row.date_approved)}</li>
                                    <li>
                                      transaction_amount: R$ {formatBRL(row.transaction_amount)}
                                    </li>
                                    <li>marketplace_fee (pedido): R$ {formatBRL(row.marketplace_fee_net)}</li>
                                  </ul>
                                </div>
                                <div>
                                  <p className="font-medium text-fg-strong">Billing (payment_info)</p>
                                  <ul className="mt-1 space-y-0.5 text-slate-600 dark:text-slate-400">
                                    <li>payment_id: {row.payment_id}</li>
                                    <li>money_release_status: {row.money_release_status}</li>
                                    <li>money_release_date: {formatDateTime(row.money_release_date)}</li>
                                    <li>
                                      sale_fee: gross {formatBRL(row.marketplace_fee_gross)} / net{" "}
                                      {formatBRL(row.marketplace_fee_net)} / rebate{" "}
                                      {formatBRL(row.marketplace_fee_rebate)}
                                    </li>
                                  </ul>
                                </div>
                                <div>
                                  <p className="font-medium text-fg-strong">Cálculo exibido</p>
                                  <p className="mt-1 font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                                    {formatBRL(row.transaction_amount)} − {formatBRL(row.marketplace_fee_net)} −{" "}
                                    {formatBRL(row.shipping_cost)} − {formatBRL(row.taxes_amount)} +{" "}
                                    {formatBRL(row.marketplace_fee_rebate)} ={" "}
                                    <strong className="text-fg-strong">{formatBRL(row.net_to_receive)}</strong>
                                  </p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </AppTable>
          </>
        )}

        {viewMode === "help" && (
          <div className="rounded-lg border border-stroke bg-card p-6 shadow-sm dark:border-slate-700">
            <RecebimentoHelpContent />
          </div>
        )}
      </div>
    </OnboardingGate>
  );
}
