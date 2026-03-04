"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const STORAGE_KEY = "escalapreco_dashboard_account_id";

interface MLAccount {
  id: string;
  ml_user_id: number;
  ml_nickname: string | null;
  site_id?: string | null;
  created_at?: string;
}

interface SummaryCards {
  synced_count: number;
  wholesale_configured_count: number;
  wholesale_missing_count: number;
  errors_or_pending_count: number;
}

interface ActivityItem {
  at: string;
  type: "sync" | "draft_manual" | "draft_import" | "apply";
  status: "ok" | "error" | "partial" | "running";
  item_id?: string;
  variation_id?: number | null;
  message: string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (sameDay) {
      return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function activityTypeLabel(type: ActivityItem["type"]): string {
  const labels: Record<ActivityItem["type"], string> = {
    sync: "Sincronização",
    draft_manual: "Edição manual",
    draft_import: "Importação CSV",
    apply: "Aplicação no ML",
  };
  return labels[type] ?? type;
}

function activityStatusLabel(status: ActivityItem["status"]): string {
  const labels: Record<ActivityItem["status"], string> = {
    ok: "Sucesso",
    error: "Erro",
    partial: "Parcial",
    running: "Em andamento",
  };
  return labels[status] ?? status;
}

function AppHomeContent() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<MLAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [summary, setSummary] = useState<{ account: { id: string; ml_user_id: number; ml_nickname: string | null }; cards: SummaryCards } | null>(null);
  const [priceHighCount, setPriceHighCount] = useState<number | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

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

  const loadPriceRefStatus = useCallback(async () => {
    if (!accountId) return;
    try {
      const res = await fetch(`/api/price-references/status?accountId=${encodeURIComponent(accountId)}`);
      if (res.ok) {
        const data = await res.json();
        setPriceHighCount(data.high ?? 0);
      } else {
        setPriceHighCount(null);
      }
    } catch {
      setPriceHighCount(null);
    }
  }, [accountId]);

  const loadActivity = useCallback(async () => {
    if (!accountId) return;
    setActivityLoading(true);
    try {
      const res = await fetch(
        `/api/dashboard/activity?accountId=${encodeURIComponent(accountId)}&limit=20`
      );
      if (res.ok) {
        const data = await res.json();
        setActivity(data.items ?? []);
      } else {
        setActivity([]);
      }
    } catch {
      setActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    loadSummary();
    loadActivity();
    loadPriceRefStatus();
  }, [accountId, loadSummary, loadActivity, loadPriceRefStatus]);

  useEffect(() => {
    if (accounts.length > 0 && accountId && !accounts.find((a) => a.id === accountId)) {
      persistAccount(accounts[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const startSync = async () => {
    if (!accountId) return;
    setSyncing(true);
    try {
      const res = await fetch(`/api/mercadolivre/${accountId}/sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        loadSummary();
        loadActivity();
      }
    } finally {
      setSyncing(false);
    }
  };

  if (loading && accounts.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-gray-500">Carregando…</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-8 text-center">
        <h1 className="mb-2 text-xl font-semibold text-amber-900">Conecte sua conta do Mercado Livre</h1>
        <p className="mb-6 text-amber-800">
          Para ver o resumo e usar o EscalaPreço, conecte pelo menos uma conta.
        </p>
        <Link
          href="/app/mercadolivre"
          className="inline-block rounded bg-yellow-400 px-5 py-2.5 font-medium text-gray-900 hover:bg-yellow-500"
        >
          Ir para Mercado Livre
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Cabeçalho do dashboard */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-app bg-white/80 p-4 shadow-sm ring-1 ring-slate-200 backdrop-blur">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Visão geral</h1>
          <p className="mt-1 text-sm text-slate-600">
            Acompanhe rapidamente a saúde dos seus anúncios e operações.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
            <StatusDot className={summaryLoading ? "bg-amber-400" : "bg-emerald-500"} />
            {summaryLoading ? "Atualizando dados..." : "Dados atualizados"}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">Conta Mercado Livre</label>
            <select
              value={accountId}
              onChange={(e) => persistAccount(e.target.value)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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

      {/* Bloco 1 — Status Geral (cards) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Status geral
            </h2>
            <p className="text-xs text-slate-500">
              Indicadores principais do uso do EscalaPreço nesta conta.
            </p>
          </div>
        </div>
        {summaryLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-slate-100 bg-white/70 p-4 shadow-sm backdrop-blur-sm animate-pulse"
              >
                <div className="flex items-center justify-between">
                  <div className="h-4 w-1/2 rounded bg-slate-200" />
                  <div className="h-8 w-10 rounded-full bg-slate-100" />
                </div>
                <div className="mt-3 h-7 w-1/3 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : summary ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {/* Total sincronizado */}
            <div className="group rounded-2xl border border-slate-100 bg-white/80 p-4 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-primary/40">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Anúncios sincronizados
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">
                    {summary.cards.synced_count}
                  </p>
                </div>
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary/15">
                  <SmallIconStack />
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Itens prontos para edição e aplicação de atacado.
              </p>
            </div>

            {/* Com atacado */}
            <div className="group rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-emerald-300/70">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                    Com atacado configurado
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-emerald-900">
                    {summary.cards.wholesale_configured_count}
                  </p>
                </div>
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200">
                  <WholesaleIcon />
                </div>
              </div>
              <p className="mt-2 text-xs text-emerald-800">
                Itens já aproveitando condições de volume.
              </p>
            </div>

            {/* Cobertura atacado */}
            <div className="group rounded-2xl border border-sky-100 bg-sky-50/80 p-4 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-sky-300/70">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-sky-800">
                    Cobertura de atacado
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-sky-900">
                    {summary.cards.synced_count > 0
                      ? Math.round(
                          (summary.cards.wholesale_configured_count /
                            summary.cards.synced_count) *
                            100
                        )
                      : 0}
                    <span className="ml-1 text-base font-medium text-sky-700">%</span>
                  </p>
                </div>
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-800 group-hover:bg-sky-200">
                  <GaugeIcon />
                </div>
              </div>
              <p className="mt-2 text-xs text-sky-800">
                Percentual de anúncios com estratégia de atacado ativa.
              </p>
            </div>

            {/* Sem atacado */}
            <div className="group rounded-2xl border border-amber-100 bg-amber-50/90 p-4 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-amber-300/70">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-amber-800">
                    Sem atacado configurado
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-amber-900">
                    {summary.cards.wholesale_missing_count}
                  </p>
                </div>
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-800 group-hover:bg-amber-200">
                  <AlertIcon />
                </div>
              </div>
              <p className="mt-2 text-xs text-amber-800">
                Oportunidade de aumentar ticket e giro com condições de volume.
              </p>
            </div>

            {/* Erros / pendências */}
            <div className="group rounded-2xl border border-rose-100 bg-rose-50/90 p-4 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-rose-300/70">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-rose-800">
                    Erros / Pendências (7 dias)
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-rose-900">
                    {summary.cards.errors_or_pending_count}
                  </p>
                </div>
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-rose-100 text-rose-800 group-hover:bg-rose-200">
                  <WarningIcon />
                </div>
              </div>
              <p className="mt-2 text-xs text-rose-800">
                Problemas recentes em sincronizações ou aplicações de atacado.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-100 bg-white/80 p-6 shadow-sm">
            <p className="text-sm text-slate-500">Não foi possível carregar o resumo.</p>
          </div>
        )}

        {/* Card de oportunidade de preço */}
        <Link
          href={`/app/atacado?accountId=${encodeURIComponent(accountId)}&filter=price_high`}
          className="block rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-amber-50 to-amber-100 p-4 text-amber-900 shadow-sm transition hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Oportunidades de ajuste de preço
              </p>
              <p className="mt-1 text-sm text-amber-900">
                Anúncios com preço acima da referência (potencial perda de conversão).
              </p>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold">
                {priceHighCount ?? 0}
              </span>
              <span className="text-xs text-amber-800">anúncios</span>
            </div>
          </div>
          <p className="mt-2 text-xs font-medium text-amber-900 underline-offset-2 hover:underline">
            Clique para ver a lista e priorizar correções.
          </p>
        </Link>
      </section>

      {/* Bloco 2 — Últimas alterações */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ActivityIcon />
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                Últimas alterações
              </h2>
              <p className="text-xs text-slate-500">
                Histórico recente de sincronizações, importações e aplicações de atacado.
              </p>
            </div>
          </div>
          <Link
            href={`/app/historico${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`}
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Ver tudo
          </Link>
        </div>
        {activityLoading ? (
          <div className="rounded-2xl border border-slate-100 bg-white/80 p-6 shadow-sm">
            <p className="text-sm text-slate-500">Carregando atividades…</p>
          </div>
        ) : activity.length === 0 ? (
          <div className="rounded-2xl border border-slate-100 bg-white/80 p-6 text-sm text-slate-500 shadow-sm">
            Nenhuma atividade recente para esta conta.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white/80 shadow-sm">
            <ul className="divide-y divide-slate-100">
              {activity.slice(0, 10).map((item, idx) => (
                <li
                  key={`${item.at}-${idx}`}
                  className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs sm:text-sm"
                >
                  <div className="flex items-center gap-2 text-slate-500">
                    <span className="inline-flex h-2 w-2 rounded-full bg-slate-300" />
                    <span>{formatDate(item.at)}</span>
                  </div>
                  <span className="ml-2 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                    {activityTypeLabel(item.type)}
                  </span>
                  <span
                    className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      item.status === "ok"
                        ? "bg-emerald-50 text-emerald-700"
                        : item.status === "error"
                          ? "bg-rose-50 text-rose-700"
                          : item.status === "partial"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-sky-50 text-sky-700"
                    }`}
                  >
                    {activityStatusLabel(item.status)}
                  </span>
                  <span className="ml-auto text-slate-700">{item.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Bloco 3 — Ações rápidas */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Ações rápidas
            </h2>
            <p className="text-xs text-slate-500">
              Atalhos para manter o catálogo sempre atualizado e competitivo.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button
            type="button"
            onClick={startSync}
            disabled={syncing || !accountId}
            className="group flex flex-col justify-between rounded-2xl border border-sky-100 bg-sky-50/90 p-4 text-left text-sky-900 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">
                  Sincronizar anúncios
                </p>
                <p className="mt-1 text-xs text-sky-800">
                  Busca novos anúncios e atualiza os existentes.
                </p>
              </div>
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-700 group-hover:bg-sky-200">
                <SyncIcon />
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold">
              {syncing ? "Sincronizando…" : "Iniciar sincronização"}
            </p>
          </button>

          <Link
            href="/app/atacado"
            className="group flex flex-col justify-between rounded-2xl border border-slate-100 bg-white/80 p-4 text-left text-slate-900 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-slate-300"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">
                  Editar preços de atacado
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Ajuste margens, faixas de quantidade e descontos.
                </p>
              </div>
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700 group-hover:bg-slate-200">
                <PencilIcon />
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold">Ir para painel de atacado</p>
          </Link>

          <Link
            href="/app/atacado"
            className="group flex flex-col justify-between rounded-2xl border border-slate-100 bg-white/80 p-4 text-left text-slate-900 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-slate-300"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">
                  Importar CSV
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Suba planilhas com ajustes em massa de atacado.
                </p>
              </div>
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700 group-hover:bg-slate-200">
                <UploadIcon />
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold">Importar arquivo</p>
          </Link>

          <Link
            href="/app/atacado"
            className="group flex flex-col justify-between rounded-2xl border border-emerald-100 bg-emerald-50/90 p-4 text-left text-emerald-900 shadow-sm ring-1 ring-transparent backdrop-blur-sm transition hover:-translate-y-0.5 hover:ring-emerald-300"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">
                  Aplicar no Mercado Livre
                </p>
                <p className="mt-1 text-xs text-emerald-800">
                  Envie para o ML as configurações de atacado aprovadas.
                </p>
              </div>
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 group-hover:bg-emerald-200">
                <ApplyIcon />
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold">Aplicar alterações</p>
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
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-gray-500">Carregando…</p>
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

function WholesaleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 7.5 12 4l8 3.5-8 3.5-8-3.5Zm0 5L12 9l8 3.5-8 3.5-8-3.5Zm0 5L12 14l8 3.5L12 21 4 17.5Z"
        className="fill-current"
      />
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

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M11.1 4.53a1.5 1.5 0 0 1 2.8 0l7 14.5A1.5 1.5 0 0 1 19.5 21h-15a1.5 1.5 0 0 1-1.34-2.14l7-14.33Z"
        className="fill-current"
      />
      <path
        d="M12 9v5"
        className="stroke-amber-50"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16" r="0.9" className="fill-amber-50" />
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

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-500" aria-hidden="true">
      <path
        d="M4 6.5h3l2.2 8 3.6-13 2.4 9 1.4-4H20"
        className="fill-none stroke-current"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
