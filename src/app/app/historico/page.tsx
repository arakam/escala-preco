"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface ActivityItem {
  at: string;
  type: "sync" | "draft_manual" | "draft_import" | "apply";
  status: "ok" | "error" | "partial" | "running";
  item_id?: string;
  variation_id?: number | null;
  message: string;
}

interface MLAccount {
  id: string;
  ml_nickname: string | null;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
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

function HistoricoContent() {
  const searchParams = useSearchParams();
  const accountIdParam = searchParams.get("accountId")?.trim() ?? "";
  const [accounts, setAccounts] = useState<MLAccount[]>([]);
  const [accountId, setAccountId] = useState(accountIdParam);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/mercadolivre/accounts");
    if (res.ok) {
      const data = await res.json();
      const list = data.accounts ?? [];
      setAccounts(list);
      if (list.length > 0 && !accountId) setAccountId(list[0].id);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (accountIdParam) setAccountId(accountIdParam);
  }, [accountIdParam]);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    fetch(`/api/dashboard/activity?accountId=${encodeURIComponent(accountId)}&limit=50`)
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [accountId]);

  if (loading && accounts.length === 0) {
    return (
      <div className="rounded-lg border border-stroke bg-card p-6 dark:border-slate-700">
        <p className="text-fg-muted">Carregando…</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-950/40">
        <p className="text-amber-800 dark:text-amber-200">
          Conecte sua conta do Mercado Livre em{" "}
          <Link href="/app/mercadolivre" className="font-medium underline">
            Mercado Livre
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-fg-strong">Histórico de alterações</h1>
        <Link href="/app" className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
          ← Voltar ao Início
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-fg">Conta:</label>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="input w-auto max-w-xs py-1.5"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.ml_nickname || a.id}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="rounded-lg border border-stroke bg-card p-6 dark:border-slate-700">
          <p className="text-fg-muted">Carregando atividades…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-stroke bg-card p-6 dark:border-slate-700">
          <p className="text-fg-muted">Nenhuma atividade para esta conta.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-stroke bg-card shadow-sm dark:border-slate-700">
          <ul className="divide-y divide-stroke dark:divide-slate-700">
            {items.map((item, idx) => (
              <li
                key={`${item.at}-${item.type}-${idx}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              >
                <span className="text-fg-muted">{formatDate(item.at)}</span>
                <span className="font-medium text-fg">{activityTypeLabel(item.type)}</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    item.status === "ok"
                      ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300"
                      : item.status === "error"
                        ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"
                        : item.status === "partial"
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                          : "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                  }`}
                >
                  {activityStatusLabel(item.status)}
                </span>
                <span className="text-fg">{item.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function HistoricoPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-stroke bg-card p-6 dark:border-slate-700">
          <p className="text-fg-muted">Carregando…</p>
        </div>
      }
    >
      <HistoricoContent />
    </Suspense>
  );
}
