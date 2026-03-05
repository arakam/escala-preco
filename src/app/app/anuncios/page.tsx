"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { AppTable } from "@/components/AppTable";

interface MLAccount {
  id: string;
  ml_nickname: string | null;
}

interface WholesaleTier {
  min_purchase_unit: number;
  amount: number;
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
  wholesale_prices_json?: WholesaleTier[] | null;
  user_product_id?: string | null;
  family_id?: string | null;
  family_name?: string | null;
}

interface JobState {
  id: string;
  status: string;
  total: number;
  processed: number;
  ok: number;
  errors: number;
}

type SortField = "item_id" | "title" | "status" | "price" | "updated_at";

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
  const [mlbuOnly, setMlbuOnly] = useState(false);
  const [mlbuCodeInput, setMlbuCodeInput] = useState("");
  const [familyModal, setFamilyModal] = useState<{ familyId: string; familyName: string } | null>(null);
  const [familyItems, setFamilyItems] = useState<ItemRow[]>([]);
  const [familyItemsLoading, setFamilyItemsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [singleMlb, setSingleMlb] = useState("");
  const [singleSyncing, setSingleSyncing] = useState(false);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [copiedMlb, setCopiedMlb] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const copyMlb = useCallback((itemId: string) => {
    navigator.clipboard.writeText(itemId).then(() => {
      setCopiedMlb(itemId);
      setTimeout(() => setCopiedMlb(null), 1800);
    });
  }, []);

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
    if (mlbuOnly) params.set("mlbu", "1");
    if (mlbuCodeInput.trim()) params.set("mlbu_code", mlbuCodeInput.trim());
    const res = await fetch(`/api/mercadolivre/${account.id}/items?${params}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    }
    setItemsLoading(false);
  }, [account, page, search, statusFilter, mlbuOnly, mlbuCodeInput]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    if (account) loadItems();
  }, [account, loadItems]);

  useEffect(() => {
    if (!familyModal || !account?.id) {
      setFamilyItems([]);
      return;
    }
    setFamilyItemsLoading(true);
    fetch(`/api/mercadolivre/${account.id}/items?family_id=${encodeURIComponent(familyModal.familyId)}&limit=100`)
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setFamilyItems(data.items ?? []))
      .catch(() => setFamilyItems([]))
      .finally(() => setFamilyItemsLoading(false));
  }, [familyModal, account?.id]);

  const pollJob = useCallback(async () => {
    if (!account || !job?.id) return;
    const res = await fetch(`/api/jobs/${job.id}`);
    if (!res.ok) return null;
    const data = await res.json();
    const j = data.job as JobState;
    if (j) {
      setJob(j);
      const isTerminal = j.status === "success" || j.status === "failed" || j.status === "partial";
      const allProcessed = j.total > 0 && j.processed >= j.total;
      if (isTerminal || (j.status === "running" && allProcessed)) {
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

  const sortedItems = useMemo(() => {
    const data = [...items];
    data.sort((a, b) => {
      const dir = sortDirection === "asc" ? 1 : -1;
      const av = a[sortField];
      const bv = b[sortField];

      if (av == null && bv == null) return 0;
      if (av == null) return 1 * dir;
      if (bv == null) return -1 * dir;

      if (sortField === "price") {
        return (Number(av) - Number(bv)) * dir;
      }

      if (sortField === "updated_at") {
        return (new Date(av as string).getTime() - new Date(bv as string).getTime()) * dir;
      }

      return String(av).localeCompare(String(bv)) * dir;
    });
    return data;
  }, [items, sortField, sortDirection]);

  function toggleSort(field: SortField) {
    setPage(1);
    setSortField((prevField) => {
      if (prevField === field) {
        setSortDirection((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevField;
      }
      setSortDirection("asc");
      return field;
    });
  }

  function renderSortIcon(field: SortField) {
    if (sortField !== field) {
      return <span className="ml-1 text-xs text-slate-400">↕</span>;
    }
    return (
      <span className="ml-1 text-xs text-primary">
        {sortDirection === "asc" ? "↑" : "↓"}
      </span>
    );
  }

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
    <div className="space-y-4">
      <div className="rounded-app bg-white/80 p-4 shadow-sm ring-1 ring-slate-200 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Anúncios</h1>
            <p className="mt-1 text-xs text-slate-600 sm:text-sm">
              Visualize rapidamente seus anúncios, atacado configurado e status no Mercado Livre.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSyncAll}
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/10">
                {syncing ? "…" : "⟳"}
              </span>
              {syncing ? "Sincronizando anúncios..." : "Importar / sincronizar todos"}
            </button>
            <div className="flex flex-wrap items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-xs shadow-sm ring-1 ring-slate-200">
              <span className="text-[11px] font-medium text-slate-600">Sincronizar anúncio específico</span>
              <input
                type="text"
                value={singleMlb}
                onChange={(e) => setSingleMlb(e.target.value)}
                placeholder="MLB123456789"
                className="w-28 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-mono text-slate-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={handleSyncSingle}
                disabled={singleSyncing || !singleMlb.trim()}
                className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {singleSyncing ? "Sincronizando…" : "Importar"}
              </button>
            </div>
          </div>
        </div>
        {singleError && (
          <p className="mt-2 text-xs text-rose-600">
            {singleError}
          </p>
        )}
        {syncing && job && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-app bg-slate-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">
            <span>
              <span className="font-semibold">Job: </span>
              <span className="uppercase tracking-wide">{job.status}</span>
              {job.total > 0 && (
                <>
                  {" · "}
                  {job.processed}/{job.total} processados
                  {job.ok > 0 && <> · {job.ok} ok</>}
                  {job.errors > 0 && <> · {job.errors} erros</>}
                </>
              )}
            </span>
            {job.status === "running" && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await fetch(`/api/jobs/${job.id}`, { method: "PATCH" });
                  } finally {
                    setSyncing(false);
                  }
                }}
                className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                Considerar finalizado
              </button>
            )}
          </div>
        )}
      </div>

      <div className="rounded-app bg-white/90 p-4 shadow-sm ring-1 ring-slate-200 backdrop-blur">
        {/* Filtros */}
        <form onSubmit={handleSearchSubmit} className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-1 items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 ring-1 ring-slate-200">
            <span className="text-xs text-slate-500">Buscar</span>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Título, MLB ou família…"
              className="h-7 flex-1 border-0 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Todos os status</option>
            <option value="active">Ativo</option>
            <option value="paused">Pausado</option>
            <option value="closed">Fechado</option>
          </select>
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-sm">
            <input
              type="checkbox"
              checked={mlbuOnly}
              onChange={(e) => {
                setMlbuOnly(e.target.checked);
                setPage(1);
              }}
              className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
            />
            <span>Só MLBU</span>
          </label>
          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs shadow-sm">
            <span className="text-slate-500">Cód. MLBU</span>
            <input
              type="text"
              value={mlbuCodeInput}
              onChange={(e) => setMlbuCodeInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setPage(1))}
              placeholder="ex: MLAU123"
              className="w-24 border-0 bg-transparent font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
          >
            Aplicar filtros
          </button>
          {(search || statusFilter || mlbuOnly || mlbuCodeInput) && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setSearchInput("");
                setStatusFilter("");
                setMlbuOnly(false);
                setMlbuCodeInput("");
                setPage(1);
              }}
              className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
            >
              Limpar
            </button>
          )}
        </form>

        {/* Tabela de anúncios */}
        {itemsLoading ? (
          <p className="text-sm text-slate-500">Carregando anúncios…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhum anúncio sincronizado. Use &quot;Importar / sincronizar todos&quot; ou importe um anúncio pelo MLB.
          </p>
        ) : (
          <>
            <AppTable
              summary={`${total} anúncio(s) — página ${page} de ${totalPages || 1}`}
              maxHeight="70vh"
            >
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Imagem
                  </th>
                  <th
                    className="cursor-pointer p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    onClick={() => toggleSort("item_id")}
                  >
                    MLB
                    {renderSortIcon("item_id")}
                  </th>
                  <th
                    className="cursor-pointer p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    onClick={() => toggleSort("title")}
                  >
                    Título
                    {renderSortIcon("title")}
                  </th>
                  <th
                    className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    title="MLBU = User Product. Família = agrupamento no modelo MLBU."
                  >
                    Modelo / Família
                  </th>
                  <th
                    className="cursor-pointer p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    onClick={() => toggleSort("status")}
                  >
                    Status
                    {renderSortIcon("status")}
                  </th>
                  <th
                    className="cursor-pointer whitespace-nowrap p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    onClick={() => toggleSort("price")}
                  >
                    Preço R$
                    {renderSortIcon("price")}
                  </th>
                  <th className="whitespace-nowrap p-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    R$ Atac. 1
                  </th>
                  <th className="whitespace-nowrap p-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Qt. Atac. 1
                  </th>
                  <th className="whitespace-nowrap p-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    R$ Atac. 2
                  </th>
                  <th className="whitespace-nowrap p-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Qt. Atac. 2
                  </th>
                  <th className="whitespace-nowrap p-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    R$ Atac. 3
                  </th>
                  <th className="whitespace-nowrap p-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Qt. Atac. 3
                  </th>
                  <th className="whitespace-nowrap p-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    R$ Atac. 4
                  </th>
                  <th className="whitespace-nowrap p-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Qt. Atac. 4
                  </th>
                  <th className="whitespace-nowrap p-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    R$ Atac. 5
                  </th>
                  <th className="whitespace-nowrap p-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Qt. Atac. 5
                  </th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Variações
                  </th>
                  <th
                    className="cursor-pointer p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
                    onClick={() => toggleSort("updated_at")}
                  >
                    Atualizado
                    {renderSortIcon("updated_at")}
                  </th>
                  <th className="p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Link
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item) => (
                  <tr
                    key={item.item_id}
                    className="border-b border-slate-100 bg-white/50 hover:bg-primary/5"
                  >
                    <td className="p-2">
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail.replace(/^http:/, "https:")}
                          alt=""
                          className="h-12 w-12 rounded-lg border border-slate-100 bg-slate-50 object-contain"
                        />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td
                      role="button"
                      tabIndex={0}
                      onClick={() => copyMlb(item.item_id)}
                      onKeyDown={(e) => e.key === "Enter" && copyMlb(item.item_id)}
                      title="Clique para copiar"
                      className="cursor-pointer select-none rounded-md bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 hover:bg-slate-100"
                    >
                      {copiedMlb === item.item_id ? (
                        <span className="text-xs font-semibold text-emerald-600">Copiado!</span>
                      ) : (
                        item.item_id
                      )}
                    </td>
                    <td className="max-w-[260px] p-2" title={item.title ?? ""}>
                      <span className="line-clamp-2 text-sm font-medium text-slate-900">
                        {item.title ?? "—"}
                      </span>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.user_product_id && (
                          <span
                            className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-100"
                            title="User Product (MLBU)"
                          >
                            MLBU
                          </span>
                        )}
                        {item.user_product_id && (
                          <span className="font-mono text-xs text-gray-600" title="Código MLBU">
                            {item.user_product_id}
                          </span>
                        )}
                        {item.family_name && (
                          <span
                            className="inline-flex max-w-[120px] items-center truncate rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700 ring-1 ring-slate-100"
                            title={`Família: ${item.family_name}`}
                          >
                            {item.family_name}
                          </span>
                        )}
                        {item.family_id && (
                          <button
                            type="button"
                            onClick={() => setFamilyModal({ familyId: item.family_id!, familyName: item.family_name ?? "" })}
                            className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                          >
                            Ver família
                          </button>
                        )}
                        {!item.user_product_id && !item.family_name && (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </div>
                    </td>
                    <td className="p-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          item.status === "active"
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                            : item.status === "paused"
                              ? "bg-amber-50 text-amber-800 ring-1 ring-amber-100"
                              : "bg-slate-50 text-slate-700 ring-1 ring-slate-100"
                        }`}
                      >
                        {item.status ?? "—"}
                      </span>
                    </td>
                    <td className="p-2 font-medium">
                      {item.price != null ? Number(item.price).toFixed(2) : "—"}
                    </td>
                    {[0, 1, 2, 3, 4].map((i) => {
                      const tier = item.wholesale_prices_json?.[i];
                      return (
                        <Fragment key={`atacado-${i}`}>
                          <td className="p-2">
                            <input
                              type="text"
                              placeholder="0,00"
                              readOnly
                              className="w-20 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                              value={tier?.amount != null ? Number(tier.amount).toFixed(2) : ""}
                            />
                          </td>
                          <td className="p-2">
                            <input
                              type="number"
                              placeholder={i === 0 ? "1" : ""}
                              min={1}
                              readOnly
                              className="w-16 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs"
                              value={tier?.min_purchase_unit ?? ""}
                            />
                          </td>
                        </Fragment>
                      );
                    })}
                    <td className="p-2 text-xs text-slate-700">
                      {item.has_variations ? "Sim" : "Não"}
                    </td>
                    <td className="p-2 text-xs text-slate-500">
                      {item.updated_at ? new Date(item.updated_at).toLocaleString() : "—"}
                    </td>
                    <td className="p-2">
                      {item.permalink ? (
                        <a
                          href={item.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/15"
                        >
                          Ver no ML
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </AppTable>

            {/* Paginação */}
            {totalPages > 1 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  Mostrando página {page} de {totalPages} · {total} anúncio(s)
                </p>
                <div className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200">
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    «
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <span className="px-2 text-xs font-semibold text-slate-800">
                    {page}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Próxima
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    className="rounded-full px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    »
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal: itens da família */}
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
