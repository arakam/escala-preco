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
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-gray-500">Carregando…</p>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <p className="text-amber-800">
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
        <h1 className="text-xl font-semibold text-gray-900">Histórico de alterações</h1>
        <Link href="/app" className="text-sm font-medium text-blue-600 hover:underline">
          ← Voltar ao Início
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">Conta:</label>
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.ml_nickname || a.id}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-gray-500">Carregando atividades…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-gray-500">Nenhuma atividade para esta conta.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <ul className="divide-y divide-gray-200">
            {items.map((item, idx) => (
              <li
                key={`${item.at}-${item.type}-${idx}`}
                className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm"
              >
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
    </div>
  );
}

export default function HistoricoPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-gray-500">Carregando…</p>
        </div>
      }
    >
      <HistoricoContent />
    </Suspense>
  );
}
