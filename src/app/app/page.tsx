"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useOnboarding } from "@/contexts/onboarding-context";
import { isPrecoAtacadoAllowed, navBlockedHref } from "@/lib/onboarding-gating";

const STORAGE_KEY = "escalapreco_dashboard_account_id";

interface MLAccount {
  id: string;
  ml_user_id: number;
  ml_nickname: string | null;
  site_id?: string | null;
  created_at?: string;
}

interface SummaryCards {
  margin_avg_percent: number | null;
  margin_revenue_estimated: number;
  risk_count: number;
  competitiveness_percent: number;
  competitiveness: {
    competitive: number;
    attention: number;
    high: number;
    none: number;
    total: number;
  };
  coverage_percent: number;
  coverage_count: number;
  total_listings: number;
}

interface DashboardSummaryPayload {
  account: { id: string; ml_user_id: number; ml_nickname: string | null };
  cards: SummaryCards;
  alerts: {
    no_cost: number;
    negative_margin: number;
    above_market: number;
    no_wholesale: number;
    no_sku_link: number;
  };
  insights: {
    top_sales: InsightRow[];
    top_margin: InsightRow[];
    top_risk: InsightRow[];
  };
}

interface InsightRow {
  item_id: string;
  variation_id: number | null;
  title: string | null;
  thumbnail: string | null;
  current_price: number;
  orders_30d: number;
  margin_percent: number | null;
  unit_profit: number | null;
  is_above_market: boolean;
  risk_status: "high" | "attention" | "ok";
  risk_reason: string | null;
}

function AppHomeContent() {
  const searchParams = useSearchParams();
  const { status: onboarding, loading: onboardingLoading } = useOnboarding();
  const [accounts, setAccounts] = useState<MLAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [summary, setSummary] = useState<DashboardSummaryPayload | null>(null);
  const [insightMetric, setInsightMetric] = useState<"sales" | "margin" | "risk">("sales");
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [refreshingRefs, setRefreshingRefs] = useState(false);

  const allowPrecoAtacado = isPrecoAtacadoAllowed(onboarding, onboardingLoading);
  const dashBlockedHref = navBlockedHref(onboarding);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/mercadolivre/accounts");
    if (res.ok) {
      const data = await res.json();
      const list = data.accounts ?? [];
      setAccounts(list);
      if (list.length > 0 && !accountId) {
        const fromUrl = searchParams.get("accountId");
        const fromStorage =
          typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        const next = fromUrl ?? fromStorage ?? list[0].id;
        setAccountId(next);
        if (typeof window !== "undefined" && next) {
          localStorage.setItem(STORAGE_KEY, next);
        }
      }
    }
    setLoading(false);
  }, [accountId, searchParams]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const persistAccount = useCallback((id: string) => {
    setAccountId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
    const url = new URL(window.location.href);
    url.searchParams.set("accountId", id);
    window.history.replaceState({}, "", url.pathname + "?" + url.searchParams.toString());
  }, []);

  const loadSummary = useCallback(async () => {
    if (!accountId) return;
    setSummaryLoading(true);
    try {
      const res = await fetch(`/api/dashboard/summary?accountId=${encodeURIComponent(accountId)}`);
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      } else {
        setSummary(null);
      }
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    loadSummary();
  }, [accountId, loadSummary]);

  useEffect(() => {
    if (accounts.length > 0 && accountId && !accounts.find((a) => a.id === accountId)) {
      persistAccount(accounts[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const refreshReferences = async () => {
    if (!accountId) return;
    setRefreshingRefs(true);
    try {
      const res = await fetch("/api/price-references/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, scope: "all" }),
      });
      await res.json();
      if (res.ok) {
        loadSummary();
      }
    } finally {
      setRefreshingRefs(false);
    }
  };

  const formatBRL = useCallback((value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "—";
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, []);

  const insightRows = useMemo(() => {
    if (!summary) return [];
    if (insightMetric === "margin") return summary.insights.top_margin;
    if (insightMetric === "risk") return summary.insights.top_risk;
    return summary.insights.top_sales;
  }, [summary, insightMetric]);

  if (loading && accounts.length === 0) {
    return (
      <div className="rounded-lg border border-stroke bg-card p-6 dark:border-slate-700">
        <p className="text-fg-muted">Carregando…</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center dark:border-amber-800 dark:bg-amber-950/40">
        <h1 className="mb-2 text-xl font-semibold text-amber-900 dark:text-amber-100">Conecte sua conta do Mercado Livre</h1>
        <p className="mb-6 text-amber-800 dark:text-amber-200">
          Para ver o resumo e usar o EscalaPreço, conecte pelo menos uma conta.
        </p>
        <Link
          href="/app/mercadolivre"
          className="inline-block rounded bg-yellow-400 px-5 py-2.5 font-medium text-amber-950 hover:bg-yellow-500 dark:bg-amber-400 dark:text-amber-950"
        >
          Ir para Mercado Livre
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {!onboardingLoading && onboarding && onboarding.current_step < 4 && (
        <section
          className="rounded-app border border-sky-200 bg-gradient-to-r from-sky-50 to-white p-4 shadow-sm dark:border-sky-900/50 dark:from-sky-950/40 dark:to-slate-900/80"
          aria-label="Primeiros passos"
        >
          <h2 className="text-sm font-semibold text-sky-900 dark:text-sky-100">Primeiros passos no EscalaPreço</h2>
          <p className="mt-1 text-xs text-sky-800 dark:text-sky-200/90">
            Siga a ordem abaixo para liberar preço e atacado no menu.
          </p>
          <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <li className="flex gap-2 rounded-lg bg-white/80 px-3 py-2 dark:bg-slate-800/60">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  onboarding.ml_connected ? "bg-emerald-500 text-white" : "bg-sky-200 text-sky-900 dark:bg-sky-800 dark:text-sky-100"
                }`}
              >
                {onboarding.ml_connected ? "✓" : "1"}
              </span>
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-50">Conectar o Mercado Livre</p>
                <Link href="/app/configuracao" className="text-xs font-medium text-primary underline-offset-2 hover:underline">
                  Abrir Configuração
                </Link>
              </div>
            </li>
            <li className="flex gap-2 rounded-lg bg-white/80 px-3 py-2 dark:bg-slate-800/60">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  onboarding.listings_synced ? "bg-emerald-500 text-white" : "bg-sky-200 text-sky-900 dark:bg-sky-800 dark:text-sky-100"
                }`}
              >
                {onboarding.listings_synced ? "✓" : "2"}
              </span>
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-50">Sincronizar anúncios</p>
                <Link
                  href={onboarding.ml_connected ? "/app/anuncios" : "/app/configuracao"}
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {onboarding.ml_connected ? "Ir a Anúncios" : "Conecte a conta primeiro"}
                </Link>
              </div>
            </li>
            <li className="flex gap-2 rounded-lg bg-white/80 px-3 py-2 dark:bg-slate-800/60">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  onboarding.products_imported ? "bg-emerald-500 text-white" : "bg-sky-200 text-sky-900 dark:bg-sky-800 dark:text-sky-100"
                }`}
              >
                {onboarding.products_imported ? "✓" : "3"}
              </span>
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-50">Importar produtos</p>
                <Link
                  href={onboarding.listings_synced ? "/app/produtos" : onboarding.ml_connected ? "/app/anuncios" : "/app/configuracao"}
                  className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                >
                  {onboarding.listings_synced ? "Ir a Produtos" : "Sincronize os anúncios antes"}
                </Link>
              </div>
            </li>
            <li className="flex gap-2 rounded-lg bg-white/80 px-3 py-2 dark:bg-slate-800/60">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-200 text-xs font-bold text-sky-900 dark:bg-sky-800 dark:text-sky-100">
                4
              </span>
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-50">Ajustar preços e atacado</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {onboarding.products_imported ? (
                    <>
                      <Link href="/app/precos" className="font-medium text-primary underline-offset-2 hover:underline">
                        Preço
                      </Link>
                      {" · "}
                      <Link href="/app/atacado" className="font-medium text-primary underline-offset-2 hover:underline">
                        Atacado
                      </Link>
                    </>
                  ) : (
                    "Disponível após importar ao menos um produto."
                  )}
                </p>
              </div>
            </li>
          </ol>
        </section>
      )}

      {/* Cabeçalho do dashboard */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-app bg-white/80 p-4 shadow-sm ring-1 ring-slate-200 backdrop-blur dark:bg-slate-800/80 dark:ring-slate-600">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Visão geral</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Acompanhe rapidamente a saúde dos seus anúncios e operações.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200 dark:bg-slate-700/50 dark:text-slate-300 dark:ring-slate-600">
            <StatusDot className={summaryLoading ? "bg-amber-400" : "bg-emerald-500"} />
            {summaryLoading ? "Atualizando dados..." : "Dados atualizados"}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Conta Mercado Livre</label>
            <select
              value={accountId}
              onChange={(e) => persistAccount(e.target.value)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-primary-light dark:focus:ring-primary-light"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ml_nickname || `Conta ${a.ml_user_id}` || a.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Saúde operacional */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Saúde operacional da precificação
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Visão rápida para decisão: lucro, risco, competitividade e qualidade dos dados.
          </p>
        </div>

        {summaryLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-slate-100 bg-white/70 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60"
              >
                <div className="h-4 w-24 rounded bg-slate-200" />
                <div className="mt-3 h-8 w-20 rounded bg-slate-100" />
                <div className="mt-3 h-3 w-40 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : summary ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div
              className={`group rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 ${
                summary.cards.margin_avg_percent != null && summary.cards.margin_avg_percent >= 15
                  ? "border-emerald-100 bg-emerald-50/80 dark:border-emerald-900/50 dark:bg-emerald-950/40"
                  : summary.cards.margin_avg_percent != null && summary.cards.margin_avg_percent >= 8
                    ? "border-amber-100 bg-amber-50/90 dark:border-amber-900/50 dark:bg-amber-950/40"
                    : "border-rose-100 bg-rose-50/90 dark:border-rose-900/50 dark:bg-rose-950/40"
              }`}
              title="Estimativa baseada nos preços atuais dos anúncios."
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Margem Média
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-50">
                    {summary.cards.margin_avg_percent != null
                      ? `${summary.cards.margin_avg_percent.toFixed(1).replace(".", ",")}%`
                      : "—"}
                  </p>
                </div>
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                  <ProfitIcon />
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                Baseado nas vendas dos últimos 30 dias.
              </p>
            </div>

            <Link
              href={`/app/precos${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`}
              className="group rounded-2xl border border-rose-100 bg-rose-50/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:ring-1 hover:ring-rose-300 dark:border-rose-900/50 dark:bg-rose-950/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300">
                    Em Risco
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-rose-900 dark:text-rose-100">
                    {summary.cards.risk_count}
                  </p>
                </div>
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200">
                  <WarningIcon />
                </div>
              </div>
              <p className="mt-2 text-xs text-rose-800 dark:text-rose-200/90">
                Margem abaixo de 5% ou negativa.
              </p>
            </Link>

            <Link
              href={
                allowPrecoAtacado
                  ? `/app/atacado?accountId=${encodeURIComponent(accountId)}`
                  : dashBlockedHref
              }
              title={
                allowPrecoAtacado
                  ? undefined
                  : "Disponível após sincronizar anúncios e cadastrar produtos."
              }
              className={`group rounded-2xl border border-amber-100 bg-amber-50/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:ring-1 hover:ring-amber-300 dark:border-amber-900/50 dark:bg-amber-950/40 ${
                allowPrecoAtacado ? "" : "opacity-55"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-200">
                    Competitivos
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-amber-900 dark:text-amber-100">
                    {summary.cards.competitiveness_percent}%
                  </p>
                </div>
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                  <GaugeIcon />
                </div>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/70">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500"
                  style={{ width: `${Math.max(4, summary.cards.competitiveness_percent)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-amber-900 dark:text-amber-100">
                Anúncios bem posicionados.
              </p>
            </Link>

            <Link
              href={`/app/produtos${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`}
              className="group rounded-2xl border border-sky-100 bg-sky-50/90 p-4 shadow-sm transition hover:-translate-y-0.5 hover:ring-1 hover:ring-sky-300 dark:border-sky-900/50 dark:bg-sky-950/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-sky-800 dark:text-sky-300">
                    Cobertura
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-sky-900 dark:text-sky-100">
                    {summary.cards.coverage_percent}%
                  </p>
                </div>
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200">
                  <SmallIconStack />
                </div>
              </div>
              <p className="mt-2 text-xs text-sky-800 dark:text-sky-200/90">
                Anúncios com custo cadastrado e vínculo SKU.
              </p>
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-100 bg-white/80 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800/80">
            <p className="text-sm text-slate-500 dark:text-slate-400">Não foi possível carregar os indicadores.</p>
          </div>
        )}
      </section>

      {/* Alertas da operação */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
            Alertas da Operação
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Priorize os pontos com impacto direto em lucro e conversão.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <AlertItem
            href={`/app/produtos${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`}
            label="Anúncios sem custo"
            count={summary?.alerts.no_cost ?? 0}
            tone="amber"
          />
          <AlertItem
            href={`/app/precos${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`}
            label="Margem negativa"
            count={summary?.alerts.negative_margin ?? 0}
            tone="rose"
          />
          <AlertItem
            href={
              allowPrecoAtacado
                ? `/app/atacado?accountId=${encodeURIComponent(accountId)}&filter=price_high`
                : dashBlockedHref
            }
            label="Acima do mercado"
            count={summary?.alerts.above_market ?? 0}
            tone="amber"
            disabled={!allowPrecoAtacado}
          />
          <AlertItem
            href={allowPrecoAtacado ? "/app/atacado" : dashBlockedHref}
            label="Sem atacado"
            count={summary?.alerts.no_wholesale ?? 0}
            tone="blue"
            disabled={!allowPrecoAtacado}
          />
          <AlertItem
            href={`/app/produtos${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`}
            label="Sem vínculo SKU"
            count={summary?.alerts.no_sku_link ?? 0}
            tone="slate"
          />
        </div>
      </section>

      {/* Insights dos anúncios */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Insights dos Anúncios
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ranking visual do que mais vende, mais gera margem e mais exige atenção.
            </p>
          </div>
          <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <MetricTab
              active={insightMetric === "sales"}
              onClick={() => setInsightMetric("sales")}
              label="Top Vendas"
            />
            <MetricTab
              active={insightMetric === "margin"}
              onClick={() => setInsightMetric("margin")}
              label="Top Margem"
            />
            <MetricTab
              active={insightMetric === "risk"}
              onClick={() => setInsightMetric("risk")}
              label="Top Risco"
            />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white/90 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800/80 sm:p-4">
          {insightRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Sem dados suficientes para gerar o ranking desta métrica.
            </div>
          ) : (
            <ul className="space-y-2">
              {insightRows.map((row, idx) => (
                <li
                  key={`${row.item_id}:${row.variation_id ?? -1}:${idx}`}
                  className="group flex items-center gap-3 rounded-xl border border-slate-100 p-3 transition hover:-translate-y-0.5 hover:bg-slate-50/70 dark:border-slate-700 dark:hover:bg-slate-700/40"
                >
                  <div className="w-7 shrink-0 text-center text-sm font-semibold text-slate-500 dark:text-slate-300">
                    #{idx + 1}
                  </div>
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-700">
                    {row.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.thumbnail} alt={row.title ?? row.item_id} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500 dark:text-slate-300">
                        sem foto
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                      {row.title ?? row.item_id}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {insightMetric === "sales"
                        ? `${row.orders_30d} vendas · Preço atual ${formatBRL(row.current_price)}`
                        : insightMetric === "margin"
                          ? `Lucro unitário estimado ${formatBRL(row.unit_profit)}`
                          : row.risk_reason ?? "Atenção operacional"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {insightMetric === "sales" ? (
                      <>
                        <p className="text-xl font-semibold text-slate-900 dark:text-slate-100">{row.orders_30d}</p>
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">vendas 30d</p>
                      </>
                    ) : insightMetric === "margin" ? (
                      <>
                        <p
                          className="text-xl font-semibold text-emerald-700 dark:text-emerald-300"
                          title="Estimativa baseada no preço atual do anúncio."
                        >
                          {row.margin_percent != null ? `${row.margin_percent.toFixed(1).replace(".", ",")}%` : "—"}
                        </p>
                        <p className="text-[11px] uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">
                          margem
                        </p>
                      </>
                    ) : (
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          row.risk_status === "high"
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-200"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200"
                        }`}
                      >
                        {row.margin_percent != null
                          ? `Margem ${row.margin_percent.toFixed(1).replace(".", ",")}%`
                          : "Sem margem"}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Ações rápidas */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Ações rápidas
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Atalhos para decisões e execução diária.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={refreshReferences}
            disabled={refreshingRefs || !accountId}
            className="group flex flex-col justify-between rounded-2xl border border-sky-100 bg-sky-50/90 p-4 text-left text-sky-900 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">
                  Atualizar referências
                </p>
                <p className="mt-1 text-xs text-sky-800">
                  Atualiza anúncios, vendas e base de cálculo.
                </p>
              </div>
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-700 group-hover:bg-sky-200">
                <SyncIcon />
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold">
              {refreshingRefs ? "Atualizando..." : "Atualizar referência"}
            </p>
          </button>

          <Link
            href={allowPrecoAtacado ? "/app/atacado" : dashBlockedHref}
            title={
              allowPrecoAtacado
                ? undefined
                : "Disponível após sincronizar anúncios e cadastrar produtos."
            }
            className={`group flex flex-col justify-between rounded-2xl border border-slate-100 bg-white/80 p-4 text-left text-slate-900 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-slate-300 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-50 dark:hover:ring-slate-600 ${
              allowPrecoAtacado ? "" : "opacity-55"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">
                  Ajustar atacado
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  Ajuste margens, faixas de quantidade e descontos.
                </p>
              </div>
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700 group-hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:group-hover:bg-slate-600">
                <PencilIcon />
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold">Abrir painel</p>
          </Link>

          <Link
            href={allowPrecoAtacado ? "/app/atacado" : dashBlockedHref}
            title={
              allowPrecoAtacado
                ? undefined
                : "Disponível após sincronizar anúncios e cadastrar produtos."
            }
            className={`group flex flex-col justify-between rounded-2xl border border-slate-100 bg-white/80 p-4 text-left text-slate-900 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-slate-300 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-50 dark:hover:ring-slate-600 ${
              allowPrecoAtacado ? "" : "opacity-55"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">
                  Importar CSV
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  Suba planilhas com ajustes em massa de atacado.
                </p>
              </div>
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700 group-hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:group-hover:bg-slate-600">
                <UploadIcon />
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold">Importar arquivo</p>
          </Link>

          <Link
            href={`/app/precos${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`}
            title={
              allowPrecoAtacado
                ? undefined
                : "Disponível após sincronizar anúncios e cadastrar produtos."
            }
            className={`group flex flex-col justify-between rounded-2xl border border-emerald-100 bg-emerald-50/90 p-4 text-left text-emerald-900 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-emerald-300 ${
              allowPrecoAtacado ? "" : "opacity-55"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">
                  Criar campanha
                </p>
                <p className="mt-1 text-xs text-emerald-800">
                  Monte campanha de promoção com os anúncios selecionados.
                </p>
              </div>
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 group-hover:bg-emerald-200">
                <ApplyIcon />
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold">Abrir calculadora</p>
          </Link>
        </div>
      </section>
    </div>
  );
}

export default function AppHomePage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-stroke bg-card p-6 dark:border-slate-700">
          <p className="text-fg-muted">Carregando…</p>
        </div>
      }
    >
      <AppHomeContent />
    </Suspense>
  );
}

function StatusDot({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-2 w-2 rounded-full ${className ?? "bg-emerald-500"}`}
    />
  );
}

function SmallIconStack() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <rect x="4" y="5" width="10" height="6" rx="1.5" className="fill-primary/30" />
      <rect x="8" y="9" width="10" height="6" rx="1.5" className="fill-primary/50" />
      <rect x="12" y="13" width="8" height="6" rx="1.5" className="fill-primary" />
    </svg>
  );
}

function GaugeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M12 4a9 9 0 0 0-9 9 1 1 0 0 0 1 1h2.05a1 1 0 0 0 .96-.73A4.5 4.5 0 0 1 11 10.05V7a1 1 0 0 1 2 0v3.05a4.5 4.5 0 0 1 4 3.22 1 1 0 0 0 .96.73H20a1 1 0 0 0 1-1 9 9 0 0 0-9-9Z"
        className="fill-current"
      />
      <path
        d="M7 16a5 5 0 0 0 10 0H7Z"
        className="fill-current opacity-80"
      />
    </svg>
  );
}

function ProfitIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 17h16M7 13l3-3 2 2 5-5"
        className="fill-none stroke-current"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 7h2v2"
        className="fill-none stroke-current"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="9" className="fill-current" />
      <path
        d="M12 8v5"
        className="stroke-rose-50"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="15.5" r="0.9" className="fill-rose-50" />
    </svg>
  );
}

function AlertItem({
  href,
  label,
  count,
  tone,
  disabled,
}: {
  href: string;
  label: string;
  count: number;
  tone: "rose" | "amber" | "blue" | "slate";
  disabled?: boolean;
}) {
  const toneClass =
    tone === "rose"
      ? "border-rose-100 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200"
      : tone === "amber"
        ? "border-amber-100 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
        : tone === "blue"
          ? "border-sky-100 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200"
          : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200";

  return (
    <Link
      href={href}
      className={`group rounded-xl border p-3 shadow-sm transition hover:-translate-y-0.5 ${toneClass} ${
        disabled ? "pointer-events-none opacity-55" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <WarningIcon />
          <p className="text-xs font-medium">{label}</p>
        </div>
        <span className="text-base font-semibold">{count}</span>
      </div>
      <p className="mt-2 text-[11px] font-medium underline-offset-2 group-hover:underline">
        Ver lista filtrada
      </p>
    </Link>
  );
}

function MetricTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
          : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700/60"
      }`}
    >
      {label}
    </button>
  );
}

function SyncIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M6 7a6 6 0 0 1 10-2l1.5-1.5a.75.75 0 0 1 1.28.53V8a.75.75 0 0 1-.75.75H14a.75.75 0 0 1-.53-1.28L15.3 6.64A3.5 3.5 0 0 0 6 9"
        className="fill-none stroke-current"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 17a6 6 0 0 1-10 2L6.5 20.5a.75.75 0 0 1-1.28-.53V16a.75.75 0 0 1 .75-.75H10a.75.75 0 0 1 .53 1.28L8.7 17.36A3.5 3.5 0 0 0 18 15"
        className="fill-none stroke-current"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M5 17.5 5.5 14l8.8-8.8a1.5 1.5 0 0 1 2.12 0l2.38 2.38a1.5 1.5 0 0 1 0 2.12L12 18.5 8.5 19Z"
        className="fill-current"
      />
      <path
        d="M13.5 6.5 17.5 10.5"
        className="stroke-white"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M12 4v11"
        className="stroke-current"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M8.5 7.5 12 4l3.5 3.5"
        className="stroke-current"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 15.5v2A1.5 1.5 0 0 0 6.5 19h11A1.5 1.5 0 0 0 19 17.5v-2"
        className="stroke-current"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ApplyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M5 5h9.5a1.5 1.5 0 0 1 1.06.44l3 3A1.5 1.5 0 0 1 19 9.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
        className="fill-current"
      />
      <path
        d="M9.5 12.5 11.5 14.5 15.5 10.5"
        className="stroke-emerald-50"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
