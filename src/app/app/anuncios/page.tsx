"use client";

import { useCallback, useEffect, useState } from "react";

interface MLAccount {
  id: string;
  ml_nickname: string | null;
}

interface ItemRow {
  item_id: string;
  title: string | null;
  status: string | null;
  price: number | null;
  has_variations: boolean;
  thumbnail: string | null;
  permalink: string | null;
  updated_at: string;
}

interface JobState {
  id: string;
  status: string;
  total: number;
  processed: number;
  ok: number;
  errors: number;
}

export default function AnunciosPage() {
  const [account, setAccount] = useState<MLAccount | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [singleMlb, setSingleMlb] = useState("");
  const [singleSyncing, setSingleSyncing] = useState(false);
  const [singleError, setSingleError] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    const res = await fetch("/api/mercadolivre/accounts");
    if (res.ok) {
      const data = await res.json();
      const accounts = data.accounts ?? [];
      setAccount(accounts[0] ?? null);
    }
    setLoading(false);
  }, []);

  const loadItems = useCallback(async () => {
    if (!account) return;
    setItemsLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    const res = await fetch(`/api/mercadolivre/${account.id}/items?${params}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    }
    setItemsLoading(false);
  }, [account, page, search, statusFilter]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    if (account) loadItems();
  }, [account, loadItems]);

  const pollJob = useCallback(async () => {
    if (!account || !job?.id) return;
    const res = await fetch(`/api/jobs/${job.id}`);
    if (!res.ok) return null;
    const data = await res.json();
    const j = data.job as JobState;
    if (j) {
      setJob(j);
      if (j.status === "success" || j.status === "failed" || j.status === "partial") {
        setSyncing(false);
        loadItems();
        return true;
      }
    }
    return false;
  }, [account, job?.id, loadItems]);

  useEffect(() => {
    if (!syncing || !job || job.status === "success" || job.status === "failed" || job.status === "partial") return;
    const t = setInterval(() => pollJob(), 2000);
    return () => clearInterval(t);
  }, [syncing, job, pollJob]);

  async function handleSyncAll() {
    if (!account) return;
    setSyncing(true);
    setSingleError(null);
    try {
      const res = await fetch(`/api/mercadolivre/${account.id}/sync`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.job_id) {
        setJob({
          id: data.job_id,
          status: "queued",
          total: 0,
          processed: 0,
          ok: 0,
          errors: 0,
        });
      } else {
        setSyncing(false);
        alert(data.error || "Erro ao iniciar sincronização");
      }
    } catch {
      setSyncing(false);
      alert("Erro ao sincronizar");
    }
  }

  async function handleSyncSingle() {
    if (!account || !singleMlb.trim()) return;
    const mlb = singleMlb.trim().toUpperCase();
    if (!mlb.startsWith("MLB")) {
      setSingleError("O ID deve começar com MLB (ex.: MLB123456789)");
      return;
    }
    setSingleSyncing(true);
    setSingleError(null);
    try {
      const res = await fetch(`/api/mercadolivre/${account.id}/items/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: mlb }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSingleMlb("");
        loadItems();
      } else {
        setSingleError(data.error || "Erro ao sincronizar anúncio");
      }
    } catch {
      setSingleError("Erro de conexão");
    } finally {
      setSingleSyncing(false);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  const totalPages = Math.ceil(total / pageSize);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-gray-500">Carregando…</p>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
        <p className="text-amber-800">
          Conecte sua conta do Mercado Livre em{" "}
          <a href="/app/configuracao" className="font-medium underline">
            Configuração
          </a>{" "}
          para ver e sincronizar anúncios.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h1 className="mb-6 text-xl font-semibold">Anúncios</h1>

      {/* Ações: Sync todos + Sync por MLB */}
      <div className="mb-6 flex flex-wrap gap-4">
        <button
          type="button"
          onClick={handleSyncAll}
          disabled={syncing}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {syncing ? "Sincronizando…" : "Importar / Sincronizar todos"}
        </button>

        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            type="text"
            value={singleMlb}
            onChange={(e) => setSingleMlb(e.target.value)}
            placeholder="MLB123456789"
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleSyncSingle}
            disabled={singleSyncing || !singleMlb.trim()}
            className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {singleSyncing ? "Sincronizando…" : "Importar anúncio"}
          </button>
          {singleError && <span className="text-sm text-red-600">{singleError}</span>}
        </div>
      </div>

      {syncing && job && (
        <div className="mb-4 rounded bg-gray-50 p-3 text-sm text-gray-700">
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

      {/* Filtros */}
      <form onSubmit={handleSearchSubmit} className="mb-6 flex flex-wrap gap-3">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por título ou MLB…"
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded bg-gray-200 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300"
        >
          Buscar
        </button>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Todos os status</option>
          <option value="active">Ativo</option>
          <option value="paused">Pausado</option>
          <option value="closed">Fechado</option>
        </select>
        {(search || statusFilter) && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setSearchInput("");
              setStatusFilter("");
              setPage(1);
            }}
            className="text-sm text-gray-600 underline hover:text-gray-900"
          >
            Limpar filtros
          </button>
        )}
      </form>

      {/* Tabela de anúncios */}
      {itemsLoading ? (
        <p className="text-gray-500">Carregando anúncios…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500">
          Nenhum anúncio sincronizado. Use &quot;Importar / Sincronizar todos&quot; ou
          importe um anúncio pelo MLB.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-600">
            {total} anúncio(s) — página {page} de {totalPages || 1}
          </p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="p-2 font-medium text-gray-700">Imagem</th>
                  <th className="p-2 font-medium text-gray-700">MLB</th>
                  <th className="p-2 font-medium text-gray-700">Título</th>
                  <th className="p-2 font-medium text-gray-700">Status</th>
                  <th className="p-2 font-medium text-gray-700">Preço</th>
                  <th className="whitespace-nowrap p-2 font-medium text-gray-700">Preço Atacado 1</th>
                  <th className="whitespace-nowrap p-2 font-medium text-gray-700">Quantidade Mínimo Atacado 1</th>
                  <th className="whitespace-nowrap p-2 font-medium text-gray-700">Preço Atacado 2</th>
                  <th className="whitespace-nowrap p-2 font-medium text-gray-700">Quantidade Mínimo Atacado 2</th>
                  <th className="whitespace-nowrap p-2 font-medium text-gray-700">Preço Atacado 3</th>
                  <th className="whitespace-nowrap p-2 font-medium text-gray-700">Quantidade Mínimo Atacado 3</th>
                  <th className="whitespace-nowrap p-2 font-medium text-gray-700">Preço Atacado 4</th>
                  <th className="whitespace-nowrap p-2 font-medium text-gray-700">Quantidade Mínimo Atacado 4</th>
                  <th className="whitespace-nowrap p-2 font-medium text-gray-700">Preço Atacado 5</th>
                  <th className="whitespace-nowrap p-2 font-medium text-gray-700">Quantidade Mínimo Atacado 5</th>
                  <th className="p-2 font-medium text-gray-700">Variações</th>
                  <th className="p-2 font-medium text-gray-700">Atualizado</th>
                  <th className="p-2 font-medium text-gray-700">Link</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.item_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="p-2">
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail.replace(/^http:/, "https:")}
                          alt=""
                          className="h-12 w-12 rounded object-contain"
                        />
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td
                      role="button"
                      tabIndex={0}
                      onClick={() => navigator.clipboard.writeText(item.item_id)}
                      onKeyDown={(e) => e.key === "Enter" && navigator.clipboard.writeText(item.item_id)}
                      title="Clique para copiar"
                      className="cursor-pointer select-none font-mono text-gray-600 hover:bg-gray-100 p-2 rounded"
                    >
                      {item.item_id}
                    </td>
                    <td className="max-w-[240px] truncate p-2" title={item.title ?? ""}>
                      {item.title ?? "—"}
                    </td>
                    <td className="p-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          item.status === "active"
                            ? "bg-green-100 text-green-800"
                            : item.status === "paused"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {item.status ?? "—"}
                      </span>
                    </td>
                    <td className="p-2 font-medium">
                      {item.price != null ? `R$ ${Number(item.price).toFixed(2)}` : "—"}
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        placeholder="0,00"
                        className="w-20 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        placeholder="1"
                        min={1}
                        className="w-16 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        placeholder="0,00"
                        className="w-20 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        placeholder=""
                        min={1}
                        className="w-16 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        placeholder="0,00"
                        className="w-20 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        placeholder=""
                        min={1}
                        className="w-16 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        placeholder="0,00"
                        className="w-20 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        placeholder=""
                        min={1}
                        className="w-16 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="text"
                        placeholder="0,00"
                        className="w-20 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        placeholder=""
                        min={1}
                        className="w-16 rounded border border-gray-200 px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="p-2">{item.has_variations ? "Sim" : "Não"}</td>
                    <td className="p-2 text-gray-500">
                      {item.updated_at ? new Date(item.updated_at).toLocaleString() : "—"}
                    </td>
                    <td className="p-2">
                      {item.permalink ? (
                        <a
                          href={item.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          ML
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="mt-6 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-sm disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="py-1 text-sm text-gray-600">
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded border border-gray-300 bg-white px-3 py-1 text-sm disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
