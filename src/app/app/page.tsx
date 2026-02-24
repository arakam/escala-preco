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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-gray-900">Início</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Conta:</label>
          <select
            value={accountId}
            onChange={(e) => persistAccount(e.target.value)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ml_nickname || `Conta ${a.ml_user_id}` || a.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Bloco 1 — Status Geral (cards) */}
      <section>
        <h2 className="mb-4 text-lg font-medium text-gray-800">Status geral</h2>
        {summaryLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm animate-pulse"
              >
                <div className="h-4 w-2/3 rounded bg-gray-200" />
                <div className="mt-2 h-8 w-1/2 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        ) : summary ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Anúncios sincronizados</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">
                {summary.cards.synced_count}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Com atacado configurado</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-700">
                {summary.cards.wholesale_configured_count}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Sem atacado</p>
              <p className="mt-1 text-2xl font-semibold text-amber-700">
                {summary.cards.wholesale_missing_count}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Erros / Pendências (7 dias)</p>
              <p className="mt-1 text-2xl font-semibold text-red-700">
                {summary.cards.errors_or_pending_count}
              </p>
            </div>
            <Link
              href={`/app/atacado?accountId=${encodeURIComponent(accountId)}&filter=price_high`}
              className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm transition hover:border-amber-300 hover:bg-amber-100"
            >
              <p className="text-sm font-medium text-amber-800">Anúncios com preço acima da referência</p>
              <p className="mt-1 text-2xl font-semibold text-amber-900">{priceHighCount ?? 0}</p>
              <p className="mt-1 text-xs text-amber-700">Clique para ver lista</p>
            </Link>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-gray-500">Não foi possível carregar o resumo.</p>
          </div>
        )}
      </section>

      {/* Bloco 2 — Últimas alterações */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-800">Últimas alterações</h2>
          <Link
            href={`/app/historico${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ""}`}
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            Ver tudo
          </Link>
        </div>
        {activityLoading ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-gray-500">Carregando…</p>
          </div>
        ) : activity.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-gray-500">Nenhuma atividade recente.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <ul className="divide-y divide-gray-200">
              {activity.slice(0, 10).map((item, idx) => (
                <li key={`${item.at}-${idx}`} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="text-gray-500">{formatDate(item.at)}</span>
                  <span className="font-medium text-gray-700">{activityTypeLabel(item.type)}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      item.status === "ok"
                        ? "bg-green-100 text-green-800"
                        : item.status === "error"
                          ? "bg-red-100 text-red-800"
                          : item.status === "partial"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {activityStatusLabel(item.status)}
                  </span>
                  <span className="text-gray-600">{item.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Bloco 3 — Ações rápidas */}
      <section>
        <h2 className="mb-4 text-lg font-medium text-gray-800">Ações rápidas</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            onClick={startSync}
            disabled={syncing || !accountId}
            className="rounded-lg border-2 border-blue-200 bg-blue-50 px-5 py-4 text-left font-medium text-blue-900 transition hover:border-blue-300 hover:bg-blue-100 disabled:opacity-50"
          >
            {syncing ? "Sincronizando…" : "Sincronizar anúncios"}
          </button>
          <Link
            href="/app/atacado"
            className="rounded-lg border-2 border-gray-200 bg-white px-5 py-4 text-left font-medium text-gray-800 transition hover:border-gray-300 hover:bg-gray-50"
          >
            Editar preços de atacado
          </Link>
          <Link
            href="/app/atacado"
            className="rounded-lg border-2 border-gray-200 bg-white px-5 py-4 text-left font-medium text-gray-800 transition hover:border-gray-300 hover:bg-gray-50"
          >
            Importar CSV
          </Link>
          <Link
            href="/app/atacado"
            className="rounded-lg border-2 border-emerald-200 bg-emerald-50 px-5 py-4 text-left font-medium text-emerald-900 transition hover:border-emerald-300 hover:bg-emerald-100"
          >
            Aplicar no Mercado Livre
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
