"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppTable } from "@/components/AppTable";

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
  user_product_id?: string | null;
  family_id?: string | null;
  family_name?: string | null;
}

function MercadoLivreContent() {
  const [accounts, setAccounts] = useState<MLAccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [jobByAccount, setJobByAccount] = useState<Record<string, JobState>>({});
  const [itemsByAccount, setItemsByAccount] = useState<Record<string, ItemRow[]>>({});
  const [itemsLoading, setItemsLoading] = useState<Record<string, boolean>>({});
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [mlbuOnly, setMlbuOnly] = useState(false);
  const [mlbuCodeInput, setMlbuCodeInput] = useState("");
  const [familyModal, setFamilyModal] = useState<{ familyId: string; familyName: string; accountId: string } | null>(null);
  const [familyItems, setFamilyItems] = useState<ItemRow[]>([]);
  const [familyItemsLoading, setFamilyItemsLoading] = useState(false);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const copyItemId = useCallback((id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedItemId(id);
      setTimeout(() => setCopiedItemId(null), 1800);
    });
  }, []);

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
      const reason = searchParams.get("reason");
      const defaultMessages: Record<string, string> = {
        cookie_missing:
          "Cookie de sessão não encontrado. Ao autorizar no Mercado Livre, não feche a aba do EscalaPreço e volte na mesma aba. Em produção, use a mesma URL (ex.: https://escalapreco.unityerp.app) em todo o fluxo.",
        state_invalid: "Segurança: state inválido. Tente conectar novamente.",
        redirect_uri_or_code:
          "A Redirect URI do seu app no Mercado Livre deve ser EXATAMENTE: " +
          (typeof window !== "undefined" ? `${window.location.origin}/api/mercadolivre/callback` : "sua URL + /api/mercadolivre/callback") +
          " — sem barra no final. Verifique no painel developers.mercadolivre.com.br.",
        token_exchange: "Falha ao trocar o código por token. Verifique Client ID, Secret e Redirect URI no .env e no app ML.",
        env_missing: "Configuração do servidor incompleta (variáveis de ambiente).",
        network: "Erro de rede. Tente novamente.",
        me_failed: "Não foi possível obter seus dados do Mercado Livre. Tente de novo.",
        db_error: "Erro ao salvar no banco. Verifique permissões (RLS) no Supabase.",
      };
      const text = message || defaultMessages[reason || ""] || "Falha ao conectar com o Mercado Livre. Verifique: 1) Redirect URI no app ML = sua URL + /api/mercadolivre/callback; 2) Não fechar a aba antes de autorizar.";
      window.history.replaceState({}, "", "/app/mercadolivre");
      alert(text);
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
    const params = new URLSearchParams({ page: "1" });
    if (mlbuOnly) params.set("mlbu", "1");
    if (mlbuCodeInput.trim()) params.set("mlbu_code", mlbuCodeInput.trim());
    const res = await fetch(`/api/mercadolivre/${accountId}/items?${params}`);
    if (res.ok) {
      const data = await res.json();
      setItemsByAccount((prev) => ({ ...prev, [accountId]: data.items ?? [] }));
    }
    setItemsLoading((prev) => ({ ...prev, [accountId]: false }));
  }, [mlbuOnly, mlbuCodeInput]);

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

  useEffect(() => {
    if (!familyModal?.accountId) {
      setFamilyItems([]);
      return;
    }
    setFamilyItemsLoading(true);
    fetch(`/api/mercadolivre/${familyModal.accountId}/items?family_id=${encodeURIComponent(familyModal.familyId)}&limit=100`)
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setFamilyItems(data.items ?? []))
      .catch(() => setFamilyItems([]))
      .finally(() => setFamilyItemsLoading(false));
  }, [familyModal]);

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
                        className="rounded bg-brand-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
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
                    <div className="mt-2">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={mlbuOnly}
                            onChange={(e) => {
                              setMlbuOnly(e.target.checked);
                              loadItems(acc.id);
                            }}
                            className="rounded border-gray-300"
                          />
                          <span>Só MLBU</span>
                        </label>
                        <div className="flex items-center gap-1 text-sm">
                          <label className="text-gray-600">Cód. MLBU:</label>
                          <input
                            type="text"
                            value={mlbuCodeInput}
                            onChange={(e) => setMlbuCodeInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && loadItems(acc.id)}
                            placeholder="ex: MLAU123"
                            className="w-28 rounded border border-gray-300 px-2 py-1 font-mono text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => loadItems(acc.id)}
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm hover:bg-gray-50"
                          >
                            Filtrar
                          </button>
                        </div>
                      </div>
                      {itemsLoading[acc.id] ? (
                        <p className="p-4 text-gray-500">Carregando itens…</p>
                      ) : (itemsByAccount[acc.id]?.length ?? 0) > 0 ? (
                        <AppTable
                          summary={`${itemsByAccount[acc.id]?.length ?? 0} itens`}
                          maxHeight="40vh"
                        >
                          <thead>
                            <tr>
                              <th className="p-2 font-medium">ID</th>
                              <th className="p-2 font-medium">Título</th>
                              <th className="p-2 font-medium" title="MLBU = User Product. Família = agrupamento no modelo MLBU.">
                                Modelo / Família
                              </th>
                              <th className="p-2 font-medium">Status</th>
                              <th className="p-2 font-medium">Preço R$</th>
                              <th className="p-2 font-medium">Variações</th>
                              <th className="p-2 font-medium">Atualizado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itemsByAccount[acc.id].map((item) => (
                              <tr key={item.item_id}>
                                <td className="p-2">
                                  <button
                                    type="button"
                                    onClick={() => copyItemId(item.item_id)}
                                    title="Clique para copiar"
                                    className="font-mono text-gray-600 hover:bg-gray-100 rounded px-1 py-0.5 -mx-1 cursor-pointer"
                                  >
                                    {copiedItemId === item.item_id ? (
                                      <span className="text-emerald-600 text-xs font-medium">Copiado!</span>
                                    ) : (
                                      item.item_id
                                    )}
                                  </button>
                                </td>
                                <td className="max-w-[200px] truncate p-2" title={item.title ?? ""}>
                                  {item.title ?? "—"}
                                </td>
                                <td className="p-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {item.user_product_id && (
                                      <span
                                        className="inline-flex rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-800"
                                        title="User Product (MLBU)"
                                      >
                                        MLBU
                                      </span>
                                    )}
                                    {item.user_product_id && (
                                      <span className="font-mono text-xs text-gray-600">{item.user_product_id}</span>
                                    )}
                                    {item.family_name && (
                                      <span
                                        className="max-w-[100px] truncate inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
                                        title={`Família: ${item.family_name}`}
                                      >
                                        {item.family_name}
                                      </span>
                                    )}
                                    {item.family_id && (
                                      <button
                                        type="button"
                                        onClick={() => setFamilyModal({ familyId: item.family_id!, familyName: item.family_name ?? "", accountId: acc.id })}
                                        className="text-xs text-brand-blue hover:underline"
                                      >
                                        Ver família
                                      </button>
                                    )}
                                    {!item.user_product_id && !item.family_name && (
                                      <span className="text-gray-400 text-xs">—</span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-2">{item.status ?? "—"}</td>
                                <td className="p-2">{item.price != null ? Number(item.price).toFixed(2) : "—"}</td>
                                <td className="p-2">{item.has_variations ? "Sim" : "Não"}</td>
                                <td className="p-2 text-gray-500">
                                  {item.updated_at ? new Date(item.updated_at).toLocaleString() : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </AppTable>
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
            className="inline-block text-sm text-brand-blue hover:underline"
          >
            + Conectar outra conta
          </a>
        </div>
      )}

      {familyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setFamilyModal(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Itens da família"
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 p-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Família: {familyModal.familyName || familyModal.familyId}
              </h2>
              <button
                type="button"
                onClick={() => setFamilyModal(null)}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="max-h-[60vh] overflow-auto p-4">
              {familyItemsLoading ? (
                <p className="text-gray-500">Carregando itens da família…</p>
              ) : familyItems.length === 0 ? (
                <p className="text-gray-500">Nenhum item encontrado nesta família.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left">
                      <th className="p-2 font-medium">MLB</th>
                      <th className="p-2 font-medium">Título</th>
                      <th className="p-2 font-medium">Preço R$</th>
                      <th className="p-2 font-medium">Cód. MLBU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {familyItems.map((it) => (
                      <tr key={it.item_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="font-mono p-2">{it.item_id}</td>
                        <td className="max-w-[280px] truncate p-2" title={it.title ?? ""}>
                          {it.title ?? "—"}
                        </td>
                        <td className="p-2">{it.price != null ? Number(it.price).toFixed(2) : "—"}</td>
                        <td className="font-mono text-gray-600 p-2">{it.user_product_id ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
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
