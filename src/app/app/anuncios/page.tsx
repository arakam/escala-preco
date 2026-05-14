"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import { AppTable } from "@/components/AppTable";
import { OnboardingGate } from "@/components/OnboardingGate";
import { SingleAnuncioImportBar, SyncImportProgress } from "@/components/SyncImportProgress";
import { useOnboarding } from "@/contexts/onboarding-context";

const STORAGE_KEY = "escalapreco_dashboard_account_id";
const FROZEN_COLUMNS_STORAGE_KEY = "escalapreco_anuncios_frozen_columns";
const PAGE_SIZE_STORAGE_KEY = "escalapreco_anuncios_page_size";
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 250, 500, 750, 1000] as const;

/** Rótulos comuns do ML (Brasil); IDs desconhecidos são exibidos como estão. */
const LISTING_TYPE_LABELS: Record<string, string> = {
  gold_special: "Clássico",
  gold_pro: "Premium",
  gold_premium: "Premium",
  gold: "Ouro",
  silver: "Prata",
  bronze: "Bronze",
  free: "Gratuito",
};

function formatListingTypeLabel(id: string | null | undefined): string {
  if (!id) return "";
  return LISTING_TYPE_LABELS[id] ?? id;
}

/** Opções do filtro (ordenadas pelo rótulo em português). */
const LISTING_TYPE_FILTER_IDS = Object.keys(LISTING_TYPE_LABELS).sort((a, b) =>
  formatListingTypeLabel(a).localeCompare(formatListingTypeLabel(b), "pt-BR")
);

const COLUMN_ORDER: ColumnKey[] = [
  "image",
  "item_id",
  "title",
  "listing_type",
  "category",
  "status",
  "price",
  "wholesale_amount_0",
  "wholesale_qty_0",
  "wholesale_amount_1",
  "wholesale_qty_1",
  "wholesale_amount_2",
  "wholesale_qty_2",
  "wholesale_amount_3",
  "wholesale_qty_3",
  "wholesale_amount_4",
  "wholesale_qty_4",
  "variations",
  "updated_at",
  "link",
];

const COLUMN_WIDTHS: Record<ColumnKey, number> = {
  image: 64,
  item_id: 120,
  title: 280,
  listing_type: 120,
  category: 140,
  status: 100,
  price: 100,
  wholesale_amount_0: 96,
  wholesale_qty_0: 88,
  wholesale_amount_1: 96,
  wholesale_qty_1: 88,
  wholesale_amount_2: 96,
  wholesale_qty_2: 88,
  wholesale_amount_3: 96,
  wholesale_qty_3: 88,
  wholesale_amount_4: 96,
  wholesale_qty_4: 88,
  variations: 104,
  updated_at: 170,
  link: 72,
};

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
  listing_type_id?: string | null;
  category_id?: string | null;
}

interface JobState {
  id: string;
  status: string;
  total: number;
  processed: number;
  ok: number;
  errors: number;
}

type SortField =
  | "item_id"
  | "title"
  | "listing_type_id"
  | "category_id"
  | "status"
  | "price"
  | "updated_at";
type ColumnKey = string;

function AnunciosHelpContent() {
  return (
    <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Como funciona a tela Anúncios</h2>
      <div className="space-y-4">
        <section>
          <h3 className="mb-2 font-medium text-slate-800 dark:text-slate-200">Objetivo</h3>
          <p>
            Esta tela mostra os <strong>anúncios do Mercado Livre</strong> já sincronizados no seu banco de dados para a
            conta selecionada. Aqui você consulta dados, copia MLB, vê tipo de publicação e categoria, preços e faixas
            de atacado vindas do cache e dispara novas importações quando precisar atualizar tudo ou só um anúncio.
          </p>
        </section>
        <section>
          <h3 className="mb-2 font-medium text-slate-800 dark:text-slate-200">Sincronizar com o Mercado Livre</h3>
          <ul className="list-inside list-disc space-y-1">
            <li>
              <strong>Importar / sincronizar todos</strong> — busca e atualiza os anúncios da conta em lote. Pode levar
              vários minutos em catálogos grandes. Enquanto roda, aparece uma barra de progresso com totais processados;
              se precisar interromper, use <strong>Encerrar e liberar nova importação</strong> (quando disponível).
            </li>
            <li>
              <strong>Incluir por MLB</strong> — informe o código do anúncio (ex.: MLB123…) e clique em{" "}
              <strong>Importar</strong> para sincronizar só aquele item.
            </li>
            <li>
              Depois da importação, outras telas que usam o mesmo cache (por exemplo <strong>Preços</strong>,{" "}
              <strong>Atacado</strong> e <strong>Produtos</strong>) passam a refletir os dados atualizados quando você
              as recarregar ou quando o fluxo delas buscar de novo o servidor.
            </li>
          </ul>
        </section>
        <section>
          <h3 className="mb-2 font-medium text-slate-800 dark:text-slate-200">Filtros e opções</h3>
          <ul className="list-inside list-disc space-y-1">
            <li>
              A linha <strong>Filtros:</strong> resume o que está aplicado em chips. <strong>Limpar</strong> zera busca,
              status, tipo de anúncio, MLBU e o filtro “só com MLBU”.
            </li>
            <li>
              O ícone de <strong>funil</strong> abre o modal de filtros: texto livre (título, MLB ou nome de família),
              status do anúncio, <strong>tipo de anúncio</strong> (publicação no ML), código MLBU e opção de listar
              apenas anúncios que possuem MLBU cadastrado no ML.
            </li>
            <li>
              O menu <strong>⋮ Opções</strong> permite <strong>exportar a página atual</strong> (CSV com as linhas
              visíveis) e <strong>atualizar a tabela</strong> sem nova importação ML (recarrega a lista do servidor com
              os mesmos filtros e página).
            </li>
          </ul>
        </section>
        <section>
          <h3 className="mb-2 font-medium text-slate-800 dark:text-slate-200">Tabela e cabeçalhos</h3>
          <ul className="list-inside list-disc space-y-1">
            <li>
              Clique no <strong>▾</strong> no título da coluna para abrir o menu: <strong>ordenar</strong> (quando
              disponível) e <strong>congelar / descongelar</strong> coluna. Várias colunas podem ficar fixas à esquerda
              ao rolar horizontalmente; a ordem dos congelados segue a ordem das colunas na tabela.
            </li>
            <li>
              <strong>MLB</strong> — clique na célula para copiar o código do anúncio.
            </li>
            <li>
              <strong>Tipo de anúncio</strong> — tipo de publicação no Mercado Livre (ex.: Clássico, Premium), conforme
              o <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">listing_type_id</code> sincronizado.
            </li>
            <li>
              <strong>Categoria</strong> — identificador da categoria no ML (
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">category_id</code>
              ), por exemplo MLB1051.
            </li>
            <li>
              Colunas de <strong>atacado</strong> (preço R$ e quantidade mínima por faixa) são exibidas como leitura a
              partir do que está salvo no cache; o cadastro e envio ao ML de preços de atacado é feito na tela{" "}
              <strong>Atacado</strong>.
            </li>
            <li>
              <strong>Link</strong> — abre o anúncio no site do Mercado Livre.
            </li>
          </ul>
        </section>
        <section>
          <h3 className="mb-2 font-medium text-slate-800 dark:text-slate-200">Paginação</h3>
          <p>
            Abaixo do título da tabela você vê quantos anúncios há nesta página e o total geral. Escolha{" "}
            <strong>Linhas</strong> por página e navegue entre páginas quando o total ultrapassar o tamanho da página.
          </p>
        </section>
      </div>
    </div>
  );
}

function AnunciosPageContent() {
  const searchParams = useSearchParams();
  const { reload: reloadOnboarding } = useOnboarding();
  const [accounts, setAccounts] = useState<MLAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [listingTypeFilter, setListingTypeFilter] = useState("");
  const [mlbuOnly, setMlbuOnly] = useState(false);
  const [mlbuCodeInput, setMlbuCodeInput] = useState("");
  const [anunciosTab, setAnunciosTab] = useState<"lista" | "como-funciona">("lista");
  const [syncing, setSyncing] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [singleMlb, setSingleMlb] = useState("");
  const [singleSyncing, setSingleSyncing] = useState(false);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [copiedMlb, setCopiedMlb] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const [headerMenuColumn, setHeaderMenuColumn] = useState<ColumnKey | null>(null);
  const [frozenColumns, setFrozenColumns] = useState<ColumnKey[]>([]);

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;

  const copyMlb = useCallback((itemId: string) => {
    navigator.clipboard.writeText(itemId).then(() => {
      setCopiedMlb(itemId);
      setTimeout(() => setCopiedMlb(null), 1800);
    });
  }, []);

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

  useEffect(() => {
    try {
      const saved = localStorage.getItem(FROZEN_COLUMNS_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        setFrozenColumns(parsed.filter((column): column is ColumnKey => COLUMN_ORDER.includes(column)));
      }
    } catch {
      setFrozenColumns([]);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
      const n = raw != null ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && PAGE_SIZE_OPTIONS.includes(n as (typeof PAGE_SIZE_OPTIONS)[number])) {
        setPageSize(n);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const fromUrl = searchParams.get("accountId");
    if (fromUrl && fromUrl !== accountId) setAccountId(fromUrl);
  }, [searchParams]);

  const loadItems = useCallback(async () => {
    if (!account) return;
    setItemsLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(pageSize) });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (listingTypeFilter) params.set("listing_type_id", listingTypeFilter);
    if (mlbuOnly) params.set("mlbu", "1");
    if (mlbuCodeInput.trim()) params.set("mlbu_code", mlbuCodeInput.trim());
    const res = await fetch(`/api/mercadolivre/${account.id}/items?${params}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    }
    setItemsLoading(false);
  }, [account, page, pageSize, search, statusFilter, listingTypeFilter, mlbuOnly, mlbuCodeInput]);

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
      const isTerminal = j.status === "success" || j.status === "failed" || j.status === "partial";
      const allProcessed = j.total > 0 && j.processed >= j.total;
      if (isTerminal || (j.status === "running" && allProcessed)) {
        setSyncing(false);
        loadItems();
        reloadOnboarding();
        return true;
      }
    }
    return false;
  }, [account, job?.id, loadItems, reloadOnboarding]);

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
        reloadOnboarding();
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
    setFiltersModalOpen(false);
  }

  const totalPages = Math.ceil(total / pageSize);

  const appliedFilters = useMemo(() => {
    const filters: string[] = [];
    if (search) filters.push(`Busca: ${search}`);
    if (statusFilter) {
      filters.push(
        `Status: ${
          statusFilter === "active" ? "Ativo" : statusFilter === "paused" ? "Pausado" : "Fechado"
        }`
      );
    }
    if (listingTypeFilter) {
      filters.push(`Tipo: ${formatListingTypeLabel(listingTypeFilter)}`);
    }
    if (mlbuOnly) filters.push("Somente MLBU");
    if (mlbuCodeInput.trim()) filters.push(`Cód. MLBU: ${mlbuCodeInput.trim()}`);
    return filters;
  }, [listingTypeFilter, mlbuCodeInput, mlbuOnly, search, statusFilter]);

  function clearFilters() {
    setSearch("");
    setSearchInput("");
    setStatusFilter("");
    setListingTypeFilter("");
    setMlbuOnly(false);
    setMlbuCodeInput("");
    setPage(1);
  }

  function exportCurrentRows() {
    const headers = ["MLB", "Título", "Tipo de anúncio", "Categoria", "Status", "Preço", "Atualizado"];
    const rows = sortedItems.map((item) => [
      item.item_id,
      item.title ?? "",
      formatListingTypeLabel(item.listing_type_id) || (item.listing_type_id ?? ""),
      item.category_id ?? "",
      item.status ?? "",
      item.price != null ? Number(item.price).toFixed(2) : "",
      item.updated_at ? new Date(item.updated_at).toLocaleString() : "",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "anuncios.csv";
    a.click();
    URL.revokeObjectURL(url);
    setOptionsMenuOpen(false);
  }

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

  function setColumnSort(field: SortField, direction: "asc" | "desc") {
    setPage(1);
    setSortField(field);
    setSortDirection(direction);
    setHeaderMenuColumn(null);
  }

  function toggleFreezeColumn(column: ColumnKey) {
    setFrozenColumns((current) => {
      const next = current.includes(column)
        ? current.filter((item) => item !== column)
        : [...current, column].sort((a, b) => COLUMN_ORDER.indexOf(a) - COLUMN_ORDER.indexOf(b));
      try {
        localStorage.setItem(FROZEN_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Mantém a interação mesmo se o storage estiver indisponível.
      }
      return next;
    });
    setHeaderMenuColumn(null);
  }

  function frozenCellClass(column: ColumnKey, className: string, header = false) {
    if (!frozenColumns.includes(column)) return className;
    const stickyBase = header
      ? "sticky z-40 bg-[#0b5ed7] shadow-[2px_0_5px_rgba(15,23,42,0.18)]"
      : "sticky z-[5] bg-white shadow-[2px_0_5px_rgba(15,23,42,0.12)] dark:bg-slate-800";
    return `${className} ${stickyBase}`;
  }

  function frozenColumnLeft(column: ColumnKey) {
    return frozenColumns
      .filter((item) => COLUMN_ORDER.indexOf(item) < COLUMN_ORDER.indexOf(column))
      .reduce((sum, item) => sum + (COLUMN_WIDTHS[item] ?? 120), 0);
  }

  function frozenCellStyle(column: ColumnKey) {
    const width = COLUMN_WIDTHS[column];
    return {
      width,
      minWidth: width,
      left: frozenColumns.includes(column) ? frozenColumnLeft(column) : undefined,
    };
  }

  function renderHeaderMenu(column: ColumnKey, sortable?: SortField) {
    if (headerMenuColumn !== column) return null;
    return (
      <div className="btn-dropdown-menu left-1 top-full z-50 mt-1 w-48 normal-case tracking-normal shadow-xl">
        {sortable && (
          <>
            <button
              type="button"
              onClick={() => setColumnSort(sortable, "asc")}
              className="btn-dropdown-item"
            >
              Ordenar crescente
            </button>
            <button
              type="button"
              onClick={() => setColumnSort(sortable, "desc")}
              className="btn-dropdown-item"
            >
              Ordenar decrescente
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => toggleFreezeColumn(column)}
          className="btn-dropdown-item border-t border-slate-100 dark:border-slate-600"
        >
          {frozenColumns.includes(column) ? "Descongelar coluna" : "Congelar coluna"}
        </button>
      </div>
    );
  }

  function renderColumnHeader(column: ColumnKey, label: string, sortable?: SortField, extraClass = "") {
    return (
      <th
        className={frozenCellClass(
          column,
          `relative select-none p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95 ${extraClass}`,
          true
        )}
        style={frozenCellStyle(column)}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setHeaderMenuColumn((current) => (current === column ? null : column));
          }}
          className="inline-flex w-full items-center justify-between gap-1 rounded-sm text-left hover:bg-white/10"
          aria-expanded={headerMenuColumn === column}
        >
          <span className="truncate">
            {label}
          </span>
          <span className="text-[10px] text-white/65">▾</span>
        </button>
        {renderHeaderMenu(column, sortable)}
      </th>
    );
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-slate-500">Carregando…</p>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm">
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
    <div className="adminty-anuncios-page space-y-5">
      <div className="overflow-hidden rounded border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <div className="border-b border-slate-200 bg-white px-3 pt-3">
          <div className="flex flex-wrap items-end gap-1">
            <button
              type="button"
              onClick={() => setAnunciosTab("lista")}
              className={
                anunciosTab === "lista"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Anúncios
            </button>
            <button
              type="button"
              onClick={() => setAnunciosTab("como-funciona")}
              className={
                anunciosTab === "como-funciona"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Como funciona?
            </button>
          </div>
        </div>

        {anunciosTab === "como-funciona" && (
          <div className="max-h-[min(70vh,720px)] overflow-y-auto border-b border-slate-100 bg-white px-4 py-4 dark:bg-slate-900/20">
            <AnunciosHelpContent />
          </div>
        )}

        {anunciosTab === "lista" && (
        <>
        <div className="border-b border-slate-100 px-3 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSyncAll}
              disabled={syncing}
              className="btn btn-primary btn-sm disabled:cursor-not-allowed"
            >
              {syncing ? "Sincronizando anúncios..." : "Importar / sincronizar todos"}
            </button>
            <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs shadow-sm">
              <span className="text-[11px] font-medium text-slate-600">Incluir por MLB</span>
              <input
                type="text"
                value={singleMlb}
                onChange={(e) => setSingleMlb(e.target.value)}
                placeholder="MLB123456789"
                className="w-28 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-mono text-slate-800 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd]"
              />
              <button
                type="button"
                onClick={handleSyncSingle}
                disabled={singleSyncing || !singleMlb.trim()}
                className="btn btn-primary btn-mini disabled:cursor-not-allowed"
              >
                {singleSyncing ? "Sincronizando…" : "Importar"}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[12px] text-slate-600">
            <span className="font-semibold text-slate-700">Filtros:</span>
            {appliedFilters.length > 0 ? (
              appliedFilters.map((filter) => (
                <span key={filter} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700">
                  {filter}
                </span>
              ))
            ) : (
              <span className="text-slate-500">Nenhum filtro aplicado</span>
            )}
            {appliedFilters.length > 0 && (
            <button
              type="button"
                onClick={clearFilters}
                className="text-[11px] font-semibold text-[#0d6efd] hover:underline"
            >
              Limpar
            </button>
          )}
          </div>
          <div className="btn-dropdown relative flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFiltersModalOpen(true)}
              className="btn btn-icon btn-sm btn-outline-secondary"
              title="Abrir filtros"
              aria-label="Abrir filtros"
            >
              <FilterIcon />
            </button>
            <button
              type="button"
              onClick={() => setOptionsMenuOpen((open) => !open)}
              className="btn btn-icon btn-sm btn-outline-secondary"
              title="Opções"
              aria-label="Opções"
              aria-expanded={optionsMenuOpen}
            >
              <KebabMenuIcon />
            </button>
            {optionsMenuOpen && (
              <div className="btn-dropdown-menu right-0 top-9 z-20 w-44">
                <button type="button" onClick={exportCurrentRows} className="btn-dropdown-item">
                  Exportar página atual
                </button>
                <button
                  type="button"
                  onClick={() => {
                    loadItems();
                    setOptionsMenuOpen(false);
                  }}
                  className="btn-dropdown-item"
                >
                  Atualizar tabela
                </button>
              </div>
            )}
          </div>
        </div>

        {(singleError || singleSyncing || (syncing && job)) && (
          <div className="px-3 pb-3 pt-2">
            {singleError && <p className="mt-2 text-xs text-rose-600">{singleError}</p>}
            {singleSyncing && <SingleAnuncioImportBar />}
            {syncing && job && (
              <div className="mt-3">
                <SyncImportProgress
                  job={job}
                  tone="app"
                  actions={
                    job.status === "running" ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await fetch(`/api/jobs/${job.id}`, { method: "PATCH" });
                          } finally {
                            setSyncing(false);
                          }
                        }}
                        className="btn btn-secondary btn-mini"
                      >
                        Encerrar e liberar nova importação
                      </button>
                    ) : undefined
                  }
                />
              </div>
            )}
          </div>
        )}

        {/* Tabela de anúncios */}
        {itemsLoading ? (
          <p className="p-3 text-sm text-slate-500">Carregando anúncios…</p>
        ) : items.length === 0 ? (
          <p className="p-3 text-sm text-slate-500">
            Nenhum anúncio sincronizado. Use &quot;Importar / sincronizar todos&quot; ou importe um anúncio pelo MLB.
          </p>
        ) : (
          <>
            <div className="pricing-table-with-sticky adminty-table-card">
            <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                <span className="font-medium text-slate-800 dark:text-slate-100">{items.length}</span>
                {" anúncio(s) na página · total "}
                <span className="font-medium text-slate-800 dark:text-slate-100">{total}</span>
              </p>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Linhas
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setPageSize(next);
                      setPage(1);
                      try {
                        localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(next));
                      } catch {
                        // ignore
                      }
                    }}
                    className="h-6 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-700 shadow-sm focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                    aria-label="Linhas por página"
                  >
                    {[...PAGE_SIZE_OPTIONS].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                {totalPages > 1 && (
                  <>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Página {page}/{totalPages}</span>
                  <div className="inline-flex items-center gap-px rounded border border-slate-200 bg-white p-px text-[11px] shadow-sm dark:border-slate-600 dark:bg-slate-800">
                    <button
                      type="button"
                      onClick={() => setPage(1)}
                      disabled={page === 1}
                      className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                      title="Primeira página"
                    >
                      «
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Anterior
                    </button>
                    <span className="min-w-[2ch] px-1.5 py-0.5 text-center font-semibold text-slate-800 dark:text-slate-100">
                      {page}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Próxima
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage(totalPages)}
                      disabled={page === totalPages}
                      className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-700"
                      title="Última página"
                    >
                      »
                    </button>
                  </div>
                  </>
                )}
              </div>
            </div>
            <AppTable
              maxHeight="70vh"
              className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
              tableClassName="table-fixed w-max min-w-[max(100%,max-content)]"
            >
              <thead className="sticky top-0 z-10">
                <tr>
                  {renderColumnHeader("image", "Imagem")}
                  {renderColumnHeader("item_id", "MLB", "item_id")}
                  {renderColumnHeader("title", "Título", "title")}
                  {renderColumnHeader("listing_type", "Tipo de anúncio", "listing_type_id")}
                  {renderColumnHeader("category", "Categoria", "category_id")}
                  {renderColumnHeader("status", "Status", "status")}
                  {renderColumnHeader("price", "Preço R$", "price", "whitespace-nowrap")}
                  {renderColumnHeader("wholesale_amount_0", "R$ Atac. 1", undefined, "whitespace-nowrap")}
                  {renderColumnHeader("wholesale_qty_0", "Qt. Atac. 1", undefined, "whitespace-nowrap")}
                  {renderColumnHeader("wholesale_amount_1", "R$ Atac. 2", undefined, "whitespace-nowrap")}
                  {renderColumnHeader("wholesale_qty_1", "Qt. Atac. 2", undefined, "whitespace-nowrap")}
                  {renderColumnHeader("wholesale_amount_2", "R$ Atac. 3", undefined, "whitespace-nowrap")}
                  {renderColumnHeader("wholesale_qty_2", "Qt. Atac. 3", undefined, "whitespace-nowrap")}
                  {renderColumnHeader("wholesale_amount_3", "R$ Atac. 4", undefined, "whitespace-nowrap")}
                  {renderColumnHeader("wholesale_qty_3", "Qt. Atac. 4", undefined, "whitespace-nowrap")}
                  {renderColumnHeader("wholesale_amount_4", "R$ Atac. 5", undefined, "whitespace-nowrap")}
                  {renderColumnHeader("wholesale_qty_4", "Qt. Atac. 5", undefined, "whitespace-nowrap")}
                  {renderColumnHeader("variations", "Variações")}
                  {renderColumnHeader("updated_at", "Atualizado", "updated_at")}
                  {renderColumnHeader("link", "Link")}
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item) => (
                  <tr
                    key={item.item_id}
                    className="border-b border-slate-100 transition-colors hover:bg-teal-50/90 dark:border-slate-700 dark:hover:bg-teal-950/40"
                  >
                    <td className={frozenCellClass("image", "p-2")} style={frozenCellStyle("image")}>
                      {item.thumbnail ? (
                        <img
                          src={item.thumbnail.replace(/^http:/, "https:")}
                          alt=""
                          className="h-10 w-10 rounded-lg border border-slate-100 bg-slate-50 object-contain dark:border-slate-600 dark:bg-slate-800/50"
                        />
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td
                      role="button"
                      tabIndex={0}
                      onClick={() => copyMlb(item.item_id)}
                      onKeyDown={(e) => e.key === "Enter" && copyMlb(item.item_id)}
                      title="Clique para copiar"
                      className={frozenCellClass(
                        "item_id",
                        "cursor-pointer select-none rounded-md bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 hover:bg-slate-100 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700"
                      )}
                      style={frozenCellStyle("item_id")}
                    >
                      {copiedMlb === item.item_id ? (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Copiado!</span>
                      ) : (
                        item.item_id
                      )}
                    </td>
                    <td
                      className={frozenCellClass("title", "max-w-[260px] p-2")}
                      style={frozenCellStyle("title")}
                      title={item.title ?? ""}
                    >
                      <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-50">
                        {item.title ?? "—"}
                      </span>
                    </td>
                    <td
                      className={frozenCellClass("listing_type", "p-2")}
                      style={frozenCellStyle("listing_type")}
                      title={item.listing_type_id ?? ""}
                    >
                      {item.listing_type_id ? (
                        <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                          {formatListingTypeLabel(item.listing_type_id)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td
                      className={frozenCellClass("category", "max-w-[140px] p-2")}
                      style={frozenCellStyle("category")}
                      title={item.category_id ?? ""}
                    >
                      {item.category_id ? (
                        <span className="font-mono text-xs text-slate-700 dark:text-slate-200">{item.category_id}</span>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td className={frozenCellClass("status", "p-2")} style={frozenCellStyle("status")}>
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
                    <td
                      className={frozenCellClass("price", "p-2 text-right text-sm font-medium tabular-nums text-slate-800 dark:text-slate-100")}
                      style={frozenCellStyle("price")}
                    >
                      {item.price != null ? Number(item.price).toFixed(2) : "—"}
                    </td>
                    {[0, 1, 2, 3, 4].map((i) => {
                      const tier = item.wholesale_prices_json?.[i];
                      return (
                        <Fragment key={`atacado-${i}`}>
                          <td
                            className={frozenCellClass(`wholesale_amount_${i}`, "p-2 text-right text-sm tabular-nums text-slate-800 dark:text-slate-100")}
                            style={frozenCellStyle(`wholesale_amount_${i}`)}
                          >
                            {tier?.amount != null ? Number(tier.amount).toFixed(2) : "—"}
                          </td>
                          <td
                            className={frozenCellClass(`wholesale_qty_${i}`, "p-2 text-right text-sm tabular-nums text-slate-800 dark:text-slate-100")}
                            style={frozenCellStyle(`wholesale_qty_${i}`)}
                          >
                            {tier?.min_purchase_unit != null ? tier.min_purchase_unit : "—"}
                          </td>
                        </Fragment>
                      );
                    })}
                    <td
                      className={frozenCellClass("variations", "p-2 text-xs text-slate-700 dark:text-slate-200")}
                      style={frozenCellStyle("variations")}
                    >
                      {item.has_variations ? (
                        <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                          Sim
                        </span>
                      ) : (
                        <span className="text-fg-muted dark:text-slate-400">Não</span>
                      )}
                    </td>
                    <td
                      className={frozenCellClass("updated_at", "p-2 text-xs text-slate-500 dark:text-slate-400")}
                      style={frozenCellStyle("updated_at")}
                    >
                      {item.updated_at ? new Date(item.updated_at).toLocaleString() : "—"}
                    </td>
                    <td className={frozenCellClass("link", "p-2")} style={frozenCellStyle("link")}>
                      {item.permalink ? (
                        <a
                          href={item.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center rounded border border-[#01a9ac]/30 bg-[#01a9ac]/10 p-1.5 text-[#018589] hover:bg-[#01a9ac]/15"
                          title="Ver no Mercado Livre"
                        >
                          <img
                            src="https://www.mercadolivre.com.br/favicon.ico"
                            alt=""
                            width={20}
                            height={20}
                            className="h-5 w-5"
                          />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </AppTable>
            </div>

          </>
        )}
        </>
        )}
      </div>

      {filtersModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setFiltersModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Filtros de anúncios"
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Filtros</h2>
                <p className="text-xs text-slate-500">Refine os anúncios exibidos na tabela.</p>
              </div>
              <button
                type="button"
                onClick={() => setFiltersModalOpen(false)}
                className="rounded border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                aria-label="Fechar filtros"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSearchSubmit} className="space-y-4 p-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Buscar
                </label>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Título, MLB ou família…"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd]"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd]"
                  >
                    <option value="">Todos os status</option>
                    <option value="active">Ativo</option>
                    <option value="paused">Pausado</option>
                    <option value="closed">Fechado</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tipo de anúncio
                  </label>
                  <select
                    value={listingTypeFilter}
                    onChange={(e) => {
                      setListingTypeFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd]"
                  >
                    <option value="">Todos os tipos</option>
                    {LISTING_TYPE_FILTER_IDS.map((id) => (
                      <option key={id} value={id}>
                        {formatListingTypeLabel(id)}
                        {LISTING_TYPE_LABELS[id] ? ` (${id})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Cód. MLBU
                  </label>
                  <input
                    type="text"
                    value={mlbuCodeInput}
                    onChange={(e) => setMlbuCodeInput(e.target.value)}
                    placeholder="ex: MLAU123"
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd]"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={mlbuOnly}
                  onChange={(e) => setMlbuOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0d6efd] focus:ring-[#0d6efd]"
                />
                Mostrar somente anúncios com MLBU
              </label>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    clearFilters();
                    setFiltersModalOpen(false);
                  }}
                  className="btn btn-secondary btn-sm"
                >
                  Limpar
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Aplicar filtros
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M4 6h16M7 12h10M10 18h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function KebabMenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="5" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="19" r="1.7" fill="currentColor" />
    </svg>
  );
}

export default function AnunciosPage() {
  return (
    <OnboardingGate required="ml">
      <AnunciosPageContent />
    </OnboardingGate>
  );
}
