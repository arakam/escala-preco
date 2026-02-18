"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface MLAccountRow {
  id: string;
  ml_user_id: number;
  ml_nickname: string | null;
  site_id: string | null;
  created_at: string;
}

interface JobState {
  id: string;
  status: string;
  total: number;
  processed: number;
  ok: number;
  errors: number;
  started_at: string | null;
  ended_at: string | null;
}

interface ItemRow {
  item_id: string;
  title: string | null;
  status: string | null;
  price: number | null;
  has_variations: boolean;
  updated_at: string;
}

function MercadoLivreContent() {
  const [accounts, setAccounts] = useState<MLAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [jobByAccount, setJobByAccount] = useState<Record<string, JobState>>({});
  const [itemsByAccount, setItemsByAccount] = useState<Record<string, ItemRow[]>>({});
  const [itemsLoading, setItemsLoading] = useState<Record<string, boolean>>({});
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/mercadolivre/accounts");
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    const message = searchParams.get("message");
    if (connected === "1") {
      window.history.replaceState({}, "", "/app/mercadolivre");
      setLoading(true);
      fetch("/api/mercadolivre/accounts")
        .then((r) => r.json())
        .then((d) => {
          setAccounts(d.accounts ?? []);
        })
        .finally(() => setLoading(false));
    }
    if (error) {
      window.history.replaceState({}, "", "/app/mercadolivre");
      alert(message || "Falha ao conectar com o Mercado Livre. Tente novamente.");
    }
  }, [searchParams]);

  const pollJob = useCallback(async (jobId: string, accountId: string) => {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) return null;
    const data = await res.json();
    const job = data.job as JobState;
    if (job) {
      setJobByAccount((prev) => ({ ...prev, [accountId]: job }));
      if (job.status === "success" || job.status === "failed" || job.status === "partial") {
        setSyncing((prev) => (prev === accountId ? null : prev));
        return "done";
      }
    }
    return null;
  }, []);

  const loadItems = useCallback(async (accountId: string) => {
    setItemsLoading((prev) => ({ ...prev, [accountId]: true }));
    const res = await fetch(`/api/mercadolivre/${accountId}/items?page=1`);
    if (res.ok) {
      const data = await res.json();
      setItemsByAccount((prev) => ({ ...prev, [accountId]: data.items ?? [] }));
    }
    setItemsLoading((prev) => ({ ...prev, [accountId]: false }));
  }, []);

  useEffect(() => {
    if (!syncing) return;
    const accountId = syncing;
    const job = jobByAccount[accountId];
    if (!job?.id || job.status === "success" || job.status === "failed" || job.status === "partial") return;
    const t = setInterval(() => {
      pollJob(job.id, accountId).then((done) => {
        if (done === "done") {
          clearInterval(t);
          loadItems(accountId);
        }
      });
    }, 2000);
    return () => clearInterval(t);
  }, [syncing, jobByAccount, pollJob, loadItems]);

  async function handleSync(accountId: string) {
    setSyncing(accountId);
    setJobByAccount((prev) => ({ ...prev, [accountId]: { id: "", status: "queued", total: 0, processed: 0, ok: 0, errors: 0, started_at: null, ended_at: null } }));
    try {
      const res = await fetch(`/api/mercadolivre/${accountId}/sync`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.job_id) {
        setJobByAccount((prev) => ({
          ...prev,
          [accountId]: {
            id: data.job_id,
            status: "queued",
            total: 0,
            processed: 0,
            ok: 0,
            errors: 0,
            started_at: null,
            ended_at: null,
          },
        }));
        await pollJob(data.job_id, accountId);
        loadItems(accountId);
      } else {
        setSyncing(null);
        alert(data.error || "Erro ao iniciar sincronização");
      }
    } catch (e) {
      setSyncing(null);
      alert("Erro ao sincronizar");
    }
  }

  function toggleItems(accountId: string) {
    if (expandedAccount === accountId) {
      setExpandedAccount(null);
      return;
    }
    setExpandedAccount(accountId);
    if (!itemsByAccount[accountId]?.length && !itemsLoading[accountId]) {
      loadItems(accountId);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-gray-500">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h1 className="mb-4 text-xl font-semibold">Mercado Livre</h1>

      {accounts.length === 0 ? (
        <div className="space-y-4">
          <p className="text-gray-600">Nenhuma conta conectada. Conecte para sincronizar anúncios.</p>
          <a
            href="/api/mercadolivre/auth"
            className="inline-block rounded bg-yellow-400 px-4 py-2 font-medium text-gray-900 hover:bg-yellow-500"
          >
            Conectar conta Mercado Livre
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-gray-600">Contas conectadas:</p>
          <ul className="divide-y divide-gray-200">
            {accounts.map((acc) => {
              const job = jobByAccount[acc.id];
              const isSyncing = syncing === acc.id;
              const showProgress = job && (isSyncing || job.status === "running" || job.status === "queued");
              return (
                <li key={acc.id} className="flex flex-col gap-2 py-3 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">
                        {acc.ml_nickname || `ID ${acc.ml_user_id}`}
                      </span>
                      {acc.site_id && (
                        <span className="ml-2 text-sm text-gray-500">({acc.site_id})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleSync(acc.id)}
                        disabled={isSyncing}
                        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isSyncing ? "Sincronizando…" : "Sincronizar anúncios"}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleItems(acc.id)}
                        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {expandedAccount === acc.id ? "Ocultar itens" : "Ver itens"}
                      </button>
                    </div>
                  </div>
                  {showProgress && job && (
                    <div className="rounded bg-gray-50 p-2 text-sm text-gray-700">
                      <span className="font-medium">Status: </span>
                      <span>{job.status}</span>
                      {job.total > 0 && (
                        <>
                          {" — "}
                          {job.processed}/{job.total} processados
                          {job.ok > 0 && <>, {job.ok} ok</>}
                          {job.errors > 0 && <>, {job.errors} erros</>}
                        </>
                      )}
                    </div>
                  )}
                  {expandedAccount === acc.id && (
                    <div className="mt-2 overflow-x-auto rounded border border-gray-200">
                      {itemsLoading[acc.id] ? (
                        <p className="p-4 text-gray-500">Carregando itens…</p>
                      ) : (itemsByAccount[acc.id]?.length ?? 0) > 0 ? (
                        <table className="min-w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <th className="p-2 font-medium">ID</th>
                              <th className="p-2 font-medium">Título</th>
                              <th className="p-2 font-medium">Status</th>
                              <th className="p-2 font-medium">Preço</th>
                              <th className="p-2 font-medium">Variações</th>
                              <th className="p-2 font-medium">Atualizado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itemsByAccount[acc.id].map((item) => (
                              <tr key={item.item_id} className="border-b border-gray-100">
                                <td className="p-2 font-mono text-gray-600">{item.item_id}</td>
                                <td className="max-w-[200px] truncate p-2" title={item.title ?? ""}>
                                  {item.title ?? "—"}
                                </td>
                                <td className="p-2">{item.status ?? "—"}</td>
                                <td className="p-2">{item.price != null ? `R$ ${item.price}` : "—"}</td>
                                <td className="p-2">{item.has_variations ? "Sim" : "Não"}</td>
                                <td className="p-2 text-gray-500">
                                  {item.updated_at ? new Date(item.updated_at).toLocaleString() : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="p-4 text-gray-500">
                          Nenhum item sincronizado. Clique em &quot;Sincronizar anúncios&quot;.
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <a
            href="/api/mercadolivre/auth"
            className="inline-block text-sm text-blue-600 hover:underline"
          >
            + Conectar outra conta
          </a>
        </div>
      )}
    </div>
  );
}

export default function MercadoLivrePage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-gray-500">Carregando…</p>
        </div>
      }
    >
      <MercadoLivreContent />
    </Suspense>
  );
}
