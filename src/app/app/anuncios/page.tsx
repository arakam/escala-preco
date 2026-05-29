"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AppTable } from "@/components/AppTable";
import { TablePageSizeSelect } from "@/components/TablePageSizeSelect";
import { OnboardingGate } from "@/components/OnboardingGate";
import {
  apiListPage,
  computeTotalPages,
  PAGE_SIZE_ALL,
} from "@/lib/table-pagination";
import { SingleAnuncioImportBar, SyncImportProgress } from "@/components/SyncImportProgress";
import { useOnboarding } from "@/contexts/onboarding-context";
import {
  filterCriticalMlItemTags,
  formatMlItemHealth,
  formatMlItemTagLabel,
  ML_ALERT_FILTER_OPTIONS,
  mlItemHealthClass,
  mlItemTagBadgeClass,
  parseMlItemTags,
  STOCK_COMPARE_OPS,
  stockCompareLabel,
  type StockCompareOp,
} from "@/lib/mercadolivre/item-tags";
import {
  formatMlItemStatusLabel,
  mlItemStatusBadgeClass,
  ML_ITEM_STATUS_FILTER_OPTIONS,
} from "@/lib/mercadolivre/item-status";
import { fulfillmentFieldsFromStoredRow } from "@/lib/mercadolivre/fulfillment-stock";
import { isIncompleteJob, shouldTrackSyncJob, type JobStatus } from "@/lib/jobs";

const STORAGE_KEY = "escalapreco_dashboard_account_id";
const SYNC_JOB_STORAGE_KEY = "escalapreco_anuncios_sync_job_id";
const FULFILLMENT_JOB_STORAGE_KEY = "escalapreco_anuncios_fulfillment_job_id";
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

function getItemFulfillment(item: ItemRow) {
  return fulfillmentFieldsFromStoredRow(item);
}

function isFullListing(item: ItemRow): boolean {
  return getItemFulfillment(item).is_fulfillment;
}

function formatFulfillmentStockTitle(item: ItemRow): string | undefined {
  const vars = item.variation_fulfillment?.filter((v) => v.fulfillment_stock != null);
  if (vars?.length) {
    const parts = vars.map(
      (v) => `${v.fulfillment_stock} (${v.inventory_id ?? "inv." + v.variation_id})`
    );
    return `Somente depósito Full por variação: ${parts.join(" + ")} = ${getItemFulfillment(item).fulfillment_stock ?? "?"}`;
  }
  const full = getItemFulfillment(item).fulfillment_stock;
  const total = item.available_quantity;
  if (full != null && total != null && total > full) {
    return `Depósito Full: ${full} (não inclui próprio/Flex: ${total - full})`;
  }
  if (full != null) return `Somente depósito Full (ML): ${full}`;
  return undefined;
}

function formatListingStockTitle(item: ItemRow): string | undefined {
  const total = item.available_quantity;
  const full = getItemFulfillment(item).fulfillment_stock;
  if (total == null) return undefined;
  if (full != null && total > full) {
    return `Total à venda: ${total} (Full ${full} + próprio/Flex ${total - full})`;
  }
  return `Total disponível para venda na publicação: ${total}`;
}

const COLUMN_ORDER: ColumnKey[] = [
  "image",
  "item_id",
  "title",
  "listing_type",
  "full",
  "full_stock",
  "category",
  "status",
  "price",
  "planned_price",
  "stock",
  "sold_quantity",
  "health",
  "mlbu",
  "ml_tags",
  "variations",
  "updated_at",
  "link",
];

const COLUMN_WIDTHS: Record<ColumnKey, number> = {
  image: 64,
  item_id: 120,
  title: 280,
  listing_type: 120,
  full: 72,
  full_stock: 96,
  category: 140,
  status: 112,
  price: 108,
  planned_price: 128,
  stock: 88,
  sold_quantity: 88,
  health: 72,
  mlbu: 120,
  ml_tags: 200,
  variations: 104,
  updated_at: 170,
  link: 72,
};

interface MLAccount {
  id: string;
  ml_nickname: string | null;
}

interface ItemRow {
  item_id: string;
  title: string | null;
  status: string | null;
  /** Preço standard cadastrado (GET /items/{id}/prices, type=standard). */
  price: number | null;
  /** Preço exibido ao comprador (GET /items/{id}/sale_price). */
  sale_price?: number | null;
  available_quantity?: number | null;
  sold_quantity?: number | null;
  health?: number | null;
  tags_json?: string[] | null;
  inventory_id?: string | null;
  is_fulfillment?: boolean | null;
  fulfillment_stock?: number | null;
  variation_fulfillment?: Array<{
    variation_id: number;
    inventory_id: string | null;
    available_quantity: number | null;
    fulfillment_stock: number | null;
  }>;
  user_product_id?: string | null;
  has_variations: boolean;
  thumbnail: string | null;
  permalink: string | null;
  updated_at: string;
  listing_type_id?: string | null;
  category_id?: string | null;
}

interface JobState {
  id: string;
  status: JobStatus;
  total: number;
  processed: number;
  ok: number;
  errors: number;
  phase?: string | null;
}

type SortField =
  | "item_id"
  | "title"
  | "listing_type_id"
  | "category_id"
  | "status"
  | "price"
  | "sale_price"
  | "available_quantity"
  | "sold_quantity"
  | "health"
  | "user_product_id"
  | "updated_at";
type ColumnKey = string;

/** Preço que o anúncio mostra no ML (sale_price); até re-sync, pode coincidir com o standard. */
function itemWorkedPrice(item: ItemRow): number | null {
  if (item.sale_price != null && Number.isFinite(Number(item.sale_price))) {
    return Number(item.sale_price);
  }
  if (item.price != null && Number.isFinite(Number(item.price))) {
    return Number(item.price);
  }
  return null;
}

function HelpFieldBadge({ kind }: { kind: "required" | "optional" }) {
  return (
    <span
      className={
        kind === "required"
          ? "inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white bg-rose-600 ring-1 ring-inset ring-rose-700 dark:bg-rose-700 dark:ring-rose-500"
          : "inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white bg-emerald-600 ring-1 ring-inset ring-emerald-700 dark:bg-emerald-700 dark:ring-emerald-500"
      }
    >
      {kind === "required" ? "Obrigatório" : "Opcional"}
    </span>
  );
}

function HelpFieldRow({
  name,
  kind,
  children,
}: {
  name: string;
  kind: "required" | "optional";
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-slate-200/90 bg-white px-3 py-2.5 dark:border-slate-600 dark:bg-slate-800/50">
      <div className="pt-0.5">
        <HelpFieldBadge kind={kind} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900 dark:text-slate-100">{name}</p>
        <p className="mt-0.5 text-slate-600 dark:text-slate-300">{children}</p>
      </div>
    </div>
  );
}

function AnunciosHelpContent() {
  return (
    <div className="space-y-6 text-sm text-slate-700 dark:text-slate-300">
      {/* 1. Aviso de leitura */}
      <div
        className="flex gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sky-950 shadow-sm dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-100"
        role="note"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-200 text-lg dark:bg-sky-800" aria-hidden>
          💡
        </span>
        <div>
          <p className="font-semibold text-sky-900 dark:text-sky-50">Leia antes de começar</p>
          <p className="mt-1 text-sky-800/95 dark:text-sky-200/95">
            Evita erros comuns (importar sem conta conectada, filtrar sem aplicar, confundir preço ML — standard —
            com preço trab. — o que o comprador vê, inclusive com promoção). Reserve 2 minutos nesta aba antes de
            sincronizar ou exportar.
          </p>
        </div>
      </div>

      {/* 2. Para que serve */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0d6efd]/10 text-lg dark:bg-[#0d6efd]/25"
            aria-hidden
          >
            📋
          </span>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Para que serve esta tela</h2>
        </div>
        <p>
          A tela <strong>Anúncios</strong> centraliza os anúncios do Mercado Livre já sincronizados na sua conta: você
          consulta status, preços, estoque, alertas do ML e dispara importações em lote ou por código MLB.
        </p>
        <p>
          Ao concluir uma importação, os dados ficam gravados no sistema e passam a alimentar as telas{" "}
          <strong>Preços</strong>, <strong>Produtos</strong>, <strong>Atacado</strong> e <strong>Promoções</strong>{" "}
          quando você as abrir ou atualizar o cache delas.
        </p>
        <p className="text-slate-600 dark:text-slate-400">
          <strong>Pré-requisito:</strong> conta do Mercado Livre conectada em{" "}
          <a href="/app/configuracao" className="font-medium text-[#0d6efd] underline hover:no-underline">
            Configuração
          </a>
          . Sem isso, a lista não carrega e a importação não inicia.
        </p>
      </section>

      {/* 3. Passo a passo */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Passo a passo</h2>
        <ol className="list-decimal space-y-2.5 pl-5 marker:font-semibold marker:text-[#0d6efd]">
          <li>
            Abra a aba <strong>Anúncios</strong> e confirme que há conta ML ativa (se não houver, conecte em{" "}
            <strong>Configuração</strong>).
          </li>
          <li>
            Clique em <strong>Importar / sincronizar todos</strong> para buscar o catálogo inteiro no Mercado Livre,{" "}
            <em>ou</em> digite o código no campo ao lado de <strong>Incluir por MLB</strong> e clique em{" "}
            <strong>Importar</strong> para um único anúncio.
          </li>
          <li>
            Aguarde a barra de <strong>Importação</strong> terminar. Para cancelar uma sync em andamento, use{" "}
            <strong>Encerrar e liberar nova importação</strong>.
          </li>
          <li>
            Clique no ícone de <strong>funil</strong> (filtros), preencha os campos no modal <strong>Filtros</strong> e
            clique em <strong>Aplicar filtros</strong> — alterações no modal só valem após esse botão.
          </li>
          <li>
            Na tabela, clique em <strong>▾</strong> no cabeçalho da coluna para <strong>Ordenar crescente</strong>,{" "}
            <strong>Ordenar decrescente</strong> ou <strong>Congelar coluna</strong> / <strong>Descongelar coluna</strong>
            . Clique na célula <strong>MLB</strong> ou <strong>MLBU</strong> para copiar o código.
          </li>
          <li>
            No menu <strong>⋮ Opções</strong>, use <strong>Exportar página atual</strong> (CSV da página visível) ou{" "}
            <strong>Atualizar tabela</strong> (recarrega a lista com os mesmos filtros, sem nova importação no ML).
          </li>
        </ol>
      </section>

      {/* 4. Campos */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Campos e o que significam</h2>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Importação (aba Anúncios)
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="optional" name="Importar / sincronizar todos">
              Inicia a sincronização de todos os anúncios da conta no Mercado Livre; pode levar vários minutos em
              catálogos grandes.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Incluir por MLB (campo de texto)">
              Código do anúncio no formato <strong>MLB</strong> + números (ex.: MLB123456789); usado só com o botão{" "}
              <strong>Importar</strong> ao lado.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Importar">
              Sincroniza apenas o MLB informado no campo; o botão fica desabilitado se o campo estiver vazio.
            </HelpFieldRow>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Modal Filtros (ícone de funil)
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="optional" name="Buscar">
              Texto livre em título, MLB ou nome da família (User Product); correspondência parcial.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Status">
              Filtra pelo status do anúncio no ML (Ativo, Pausado, Fechado, etc.); opção vazia = todos.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Tipo de anúncio">
              Tipo de publicação sincronizado (ex.: Clássico, Premium); vem do <code className="text-xs">listing_type_id</code> do ML.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Mostrar somente anúncios Full">
              Lista apenas anúncios marcados como Full (estoque Full na API ou tag/frete de fulfillment na sync).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Cód. MLBU">
              Filtra pelo código User Product (ex.: MLAU…); busca parcial no campo sincronizado.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Mostrar somente anúncios com MLBU">
              Quando marcado, exibe só linhas que possuem código MLBU preenchido.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Alertas ML">
              Filtra por tags críticas do Mercado Livre (ficha incompleta, catálogo, migração UP, etc.).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Estoque — Condição">
              Operador de comparação (maior que, menor que, igual…); escolha <strong>Sem filtro de estoque</strong> para ignorar.
            </HelpFieldRow>
            <HelpFieldRow kind="required" name="Estoque — Quantidade">
              Número inteiro ≥ 0; só é aplicado se você escolheu uma condição em <strong>Estoque — Condição</strong>.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Vendidos — Condição">
              Mesma lógica do estoque, usando unidades vendidas (<code className="text-xs">sold_quantity</code>).
            </HelpFieldRow>
            <HelpFieldRow kind="required" name="Vendidos — Quantidade">
              Obrigatória quando há condição em <strong>Vendidos — Condição</strong>; inteiro ≥ 0.
            </HelpFieldRow>
            <HelpFieldRow kind="required" name="Aplicar filtros">
              Confirma os valores do modal e recarrega a tabela; sem este clique, nada do modal entra em vigor.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Limpar">
              Zera todos os filtros aplicados e os campos do modal; fecha o modal se estiver aberto pelo botão no rodapé.
            </HelpFieldRow>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Barra acima da tabela
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="optional" name="Filtros: (chips)">
              Mostra resumo dos filtros já aplicados; o link <strong>Limpar</strong> ao lado remove todos de uma vez.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Linhas">
              Quantidade de anúncios por página (10 a 1000); alterar reinicia na página 1 da navegação.
            </HelpFieldRow>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Colunas da tabela (somente leitura)
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="optional" name="MLB">
              Código do anúncio; clique na célula para copiar.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Preço ML">
              Preço <strong>standard</strong> cadastrado (sem promoção), via API de preços do ML na última sync.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Preço trab.">
              Preço que o anúncio está <strong>exibindo</strong> agora (preço de venda vencedor /{" "}
              <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">sale_price</code> do ML). Com
              promoção ativa, pode ser menor que o Preço ML.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Full">
              <strong>Sim</strong> quando o ML informa <code className="text-xs">inventory_id</code> no anúncio (ou
              variação), há saldo no depósito Full, ou tag/frete de fulfillment na última sync.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Estoque">
              Quantidade total disponível para venda na publicação: estoque Full + estoque próprio/Flex.
              Em anúncios MLBU, soma todas as localizações do{" "}
              <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">
                GET /user-products/&#123;id&#125;/stock
              </code>
              ; nos demais, vem do <code className="text-xs">available_quantity</code> do GET /items.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Estoque Full">
              Somente saldo no depósito Full do ML (
              <code className="text-xs">meli_facility</code> ou{" "}
              <code className="text-xs">available_quantity</code> em{" "}
              <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-900">
                GET /inventories/&#123;id&#125;/stock/fulfillment
              </code>
              ). Não inclui estoque próprio/Flex.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Estoque / Vendidos">
              Quantidade disponível e unidades vendidas conforme retorno da API na sync.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Alertas ML">
              Chips com alertas críticos do ML (ex.: Ficha incompleta, Foto fraca); passar o mouse mostra o código técnico.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Link">
              Abre o anúncio no site do Mercado Livre em nova aba.
            </HelpFieldRow>
          </div>
        </div>
      </section>
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
  const [statusFilter, setStatusFilter] = useState("");
  const [listingTypeFilter, setListingTypeFilter] = useState("");
  const [fullOnly, setFullOnly] = useState(false);
  const [mlbuOnly, setMlbuOnly] = useState(false);
  const [mlbuCodeFilter, setMlbuCodeFilter] = useState("");
  const [mlAlertFilter, setMlAlertFilter] = useState("");
  const [stockOpFilter, setStockOpFilter] = useState<StockCompareOp | "">("");
  const [stockQtyFilter, setStockQtyFilter] = useState("");
  const [soldOpFilter, setSoldOpFilter] = useState<StockCompareOp | "">("");
  const [soldQtyFilter, setSoldQtyFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [listingTypeDraft, setListingTypeDraft] = useState("");
  const [fullOnlyDraft, setFullOnlyDraft] = useState(false);
  const [mlbuOnlyDraft, setMlbuOnlyDraft] = useState(false);
  const [mlbuCodeDraft, setMlbuCodeDraft] = useState("");
  const [mlAlertDraft, setMlAlertDraft] = useState("");
  const [stockOpDraft, setStockOpDraft] = useState<StockCompareOp | "">("");
  const [stockQtyDraft, setStockQtyDraft] = useState("");
  const [soldOpDraft, setSoldOpDraft] = useState<StockCompareOp | "">("");
  const [soldQtyDraft, setSoldQtyDraft] = useState("");
  const [anunciosTab, setAnunciosTab] = useState<"lista" | "como-funciona">("lista");
  const [syncing, setSyncing] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [fulfillmentTracking, setFulfillmentTracking] = useState(false);
  const [fulfillmentJob, setFulfillmentJob] = useState<JobState | null>(null);
  const [singleMlb, setSingleMlb] = useState("");
  const [singleSyncing, setSingleSyncing] = useState(false);
  const [singleError, setSingleError] = useState<string | null>(null);
  const [copiedMlb, setCopiedMlb] = useState<string | null>(null);
  const [copiedMlbu, setCopiedMlbu] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const [headerMenuColumn, setHeaderMenuColumn] = useState<ColumnKey | null>(null);
  const [frozenColumns, setFrozenColumns] = useState<ColumnKey[]>([]);
  const syncRestoreGenerationRef = useRef(0);
  const syncStallPollsRef = useRef(0);
  const syncLastProcessedRef = useRef<number | null>(null);
  const syncFinishHandledRef = useRef<string | null>(null);
  const fulfillmentFinishHandledRef = useRef<string | null>(null);
  const fulfillmentStallPollsRef = useRef(0);
  const fulfillmentLastProcessedRef = useRef<number | null>(null);

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;

  const rememberSyncJob = useCallback((jobId: string) => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(SYNC_JOB_STORAGE_KEY, jobId);
    }
  }, []);

  const forgetSyncJob = useCallback(() => {
    syncStallPollsRef.current = 0;
    syncLastProcessedRef.current = null;
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(SYNC_JOB_STORAGE_KEY);
    }
  }, []);

  const forgetFulfillmentJob = useCallback(() => {
    fulfillmentStallPollsRef.current = 0;
    fulfillmentLastProcessedRef.current = null;
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(FULFILLMENT_JOB_STORAGE_KEY);
    }
  }, []);

  const rememberFulfillmentJob = useCallback((jobId: string) => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(FULFILLMENT_JOB_STORAGE_KEY, jobId);
    }
  }, []);

  const applyTrackedFulfillmentJob = useCallback(
    (j: JobState) => {
      setFulfillmentTracking(true);
      setFulfillmentJob({
        id: j.id,
        status: j.status,
        total: j.total ?? 0,
        processed: j.processed ?? 0,
        ok: j.ok ?? 0,
        errors: j.errors ?? 0,
        phase: j.phase ?? "fulfillment",
      });
      rememberFulfillmentJob(j.id);
    },
    [rememberFulfillmentJob]
  );

  const applyTrackedJob = useCallback((j: JobState) => {
    setSyncing(true);
    setJob({
      id: j.id,
      status: j.status,
      total: j.total ?? 0,
      processed: j.processed ?? 0,
      ok: j.ok ?? 0,
      errors: j.errors ?? 0,
      phase: j.phase ?? null,
    });
    rememberSyncJob(j.id);
  }, [rememberSyncJob]);

  const copyMlb = useCallback((itemId: string) => {
    navigator.clipboard.writeText(itemId).then(() => {
      setCopiedMlb(itemId);
      setTimeout(() => setCopiedMlb(null), 1800);
    });
  }, []);

  const copyMlbu = useCallback((code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedMlbu(code);
      setTimeout(() => setCopiedMlbu(null), 1800);
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
      if (
        Number.isFinite(n) &&
        (n === PAGE_SIZE_ALL ||
          PAGE_SIZE_OPTIONS.includes(n as (typeof PAGE_SIZE_OPTIONS)[number]))
      ) {
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

  const loadItems = useCallback(async (opts?: { silent?: boolean }) => {
    if (!account) return;
    if (!opts?.silent) setItemsLoading(true);
    const params = new URLSearchParams({
      page: String(apiListPage(pageSize, page)),
      limit: String(pageSize),
    });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (listingTypeFilter) params.set("listing_type_id", listingTypeFilter);
    if (fullOnly) params.set("full_only", "1");
    if (mlbuOnly) params.set("mlbu", "1");
    if (mlbuCodeFilter.trim()) params.set("mlbu_code", mlbuCodeFilter.trim());
    if (mlAlertFilter) params.set("ml_alert", mlAlertFilter);
    if (stockOpFilter) {
      const qty = parseInt(stockQtyFilter.trim(), 10);
      if (Number.isFinite(qty) && qty >= 0) {
        params.set("stock_op", stockOpFilter);
        params.set("stock_qty", String(qty));
      }
    }
    if (soldOpFilter) {
      const qty = parseInt(soldQtyFilter.trim(), 10);
      if (Number.isFinite(qty) && qty >= 0) {
        params.set("sold_op", soldOpFilter);
        params.set("sold_qty", String(qty));
      }
    }
    const res = await fetch(`/api/mercadolivre/${account.id}/items?${params}`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
    }
    setItemsLoading(false);
  }, [
    account,
    page,
    pageSize,
    search,
    statusFilter,
    listingTypeFilter,
    fullOnly,
    mlbuOnly,
    mlbuCodeFilter,
    mlAlertFilter,
    stockOpFilter,
    stockQtyFilter,
    soldOpFilter,
    soldQtyFilter,
  ]);

  const syncFilterDraftFromApplied = useCallback(() => {
    setSearchInput(search);
    setStatusDraft(statusFilter);
    setListingTypeDraft(listingTypeFilter);
    setFullOnlyDraft(fullOnly);
    setMlbuOnlyDraft(mlbuOnly);
    setMlbuCodeDraft(mlbuCodeFilter);
    setMlAlertDraft(mlAlertFilter);
    setStockOpDraft(stockOpFilter);
    setStockQtyDraft(stockQtyFilter);
    setSoldOpDraft(soldOpFilter);
    setSoldQtyDraft(soldQtyFilter);
  }, [
    listingTypeFilter,
    fullOnly,
    mlAlertFilter,
    mlbuCodeFilter,
    mlbuOnly,
    search,
    statusFilter,
    stockOpFilter,
    stockQtyFilter,
    soldOpFilter,
    soldQtyFilter,
  ]);

  useEffect(() => {
    if (account) loadItems();
  }, [account, loadItems]);

  useEffect(() => {
    if (!account) {
      setSyncing(false);
      setJob(null);
      forgetSyncJob();
      setFulfillmentTracking(false);
      setFulfillmentJob(null);
      forgetFulfillmentJob();
      return;
    }

    const generation = ++syncRestoreGenerationRef.current;
    let cancelled = false;

    const restoreJobFromStorage = async (
      storageKey: string
    ): Promise<JobState | null | undefined> => {
      const storedId =
        typeof window !== "undefined" ? sessionStorage.getItem(storageKey) : null;
      if (!storedId) return undefined;
      const jr = await fetch(`/api/jobs/${storedId}`);
      if (!jr.ok) return undefined;
      const jd = await jr.json();
      return jd.job as JobState | null | undefined;
    };

    (async () => {
      try {
        const res = await fetch(`/api/mercadolivre/${account.id}/sync`);
        if (cancelled || generation !== syncRestoreGenerationRef.current || !res.ok) return;
        const data = await res.json();
        if (cancelled || generation !== syncRestoreGenerationRef.current) return;

        let j = data.job as JobState | null | undefined;
        if (!j || !shouldTrackSyncJob(j)) {
          const stored = await restoreJobFromStorage(SYNC_JOB_STORAGE_KEY);
          if (stored && shouldTrackSyncJob(stored)) j = stored;
        }

        let fj = data.fulfillment_job as JobState | null | undefined;
        if (!fj || !shouldTrackSyncJob(fj)) {
          const storedF = await restoreJobFromStorage(FULFILLMENT_JOB_STORAGE_KEY);
          if (storedF && shouldTrackSyncJob(storedF)) fj = storedF;
        }

        if (cancelled || generation !== syncRestoreGenerationRef.current) return;

        if (j && shouldTrackSyncJob(j)) {
          applyTrackedJob(j);
        } else {
          setSyncing(false);
          setJob(null);
          forgetSyncJob();
        }

        if (fj && shouldTrackSyncJob(fj)) {
          applyTrackedFulfillmentJob(fj);
        } else {
          setFulfillmentTracking(false);
          setFulfillmentJob(null);
          forgetFulfillmentJob();
        }
      } catch {
        if (!cancelled && generation === syncRestoreGenerationRef.current) {
          setSyncing(false);
          setJob(null);
          forgetSyncJob();
          setFulfillmentTracking(false);
          setFulfillmentJob(null);
          forgetFulfillmentJob();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account?.id, applyTrackedJob, applyTrackedFulfillmentJob, forgetSyncJob, forgetFulfillmentJob]);

  const finishFulfillmentSync = useCallback(
    (jobId: string) => {
      if (fulfillmentFinishHandledRef.current === jobId) return;
      fulfillmentFinishHandledRef.current = jobId;
      setFulfillmentTracking(false);
      forgetFulfillmentJob();
      void loadItems({ silent: true });
    },
    [forgetFulfillmentJob, loadItems]
  );

  const finishSync = useCallback(
    async (jobId: string) => {
      if (syncFinishHandledRef.current === jobId) return;
      syncFinishHandledRef.current = jobId;
      setSyncing(false);
      forgetSyncJob();
      void loadItems({ silent: true });
      void reloadOnboarding();

      if (!account) return;
      try {
        const res = await fetch(`/api/mercadolivre/${account.id}/sync`);
        if (!res.ok) return;
        const data = await res.json();
        const fj = data.fulfillment_job as JobState | null | undefined;
        if (fj && shouldTrackSyncJob(fj)) {
          fulfillmentFinishHandledRef.current = null;
          applyTrackedFulfillmentJob(fj);
        }
      } catch {
        // ignore
      }
    },
    [account, applyTrackedFulfillmentJob, forgetSyncJob, loadItems, reloadOnboarding]
  );

  const pollJob = useCallback(async () => {
    if (!account || !job?.id) return;
    const res = await fetch(`/api/jobs/${job.id}`);
    if (!res.ok) return null;
    const data = await res.json();
    const j = data.job as JobState;
    if (!j) return false;

    setJob(j);

    if (!shouldTrackSyncJob(j)) {
      finishSync(j.id);
      return true;
    }

    if ((j.status === "failed" || j.status === "partial") && isIncompleteJob(j)) {
      if (syncLastProcessedRef.current === j.processed) {
        syncStallPollsRef.current += 1;
      } else {
        syncStallPollsRef.current = 0;
        syncLastProcessedRef.current = j.processed;
      }
      if (syncStallPollsRef.current >= 3) {
        finishSync(j.id);
        return true;
      }
    } else {
      syncStallPollsRef.current = 0;
      syncLastProcessedRef.current = j.processed;
    }

    return false;
  }, [account, job?.id, finishSync]);

  const pollFulfillmentJob = useCallback(async () => {
    if (!account || !fulfillmentJob?.id) return;
    const res = await fetch(`/api/jobs/${fulfillmentJob.id}`);
    if (!res.ok) return null;
    const data = await res.json();
    const j = data.job as JobState;
    if (!j) return false;

    setFulfillmentJob(j);

    if (!shouldTrackSyncJob(j)) {
      finishFulfillmentSync(j.id);
      return true;
    }

    if ((j.status === "failed" || j.status === "partial") && isIncompleteJob(j)) {
      if (fulfillmentLastProcessedRef.current === j.processed) {
        fulfillmentStallPollsRef.current += 1;
      } else {
        fulfillmentStallPollsRef.current = 0;
        fulfillmentLastProcessedRef.current = j.processed;
      }
      if (fulfillmentStallPollsRef.current >= 3) {
        finishFulfillmentSync(j.id);
        return true;
      }
    } else {
      fulfillmentStallPollsRef.current = 0;
      fulfillmentLastProcessedRef.current = j.processed;
    }

    return false;
  }, [account, fulfillmentJob?.id, finishFulfillmentSync]);

  useEffect(() => {
    if (!fulfillmentTracking || !fulfillmentJob) return;
    if (!shouldTrackSyncJob(fulfillmentJob)) return;
    const t = setInterval(() => pollFulfillmentJob(), 2000);
    return () => clearInterval(t);
  }, [fulfillmentTracking, fulfillmentJob, pollFulfillmentJob]);

  useEffect(() => {
    if (!syncing || !job) return;
    if (!shouldTrackSyncJob(job)) return;
    const t = setInterval(() => pollJob(), 2000);
    return () => clearInterval(t);
  }, [syncing, job, pollJob]);

  async function handleSyncAll() {
    if (!account) return;
    syncRestoreGenerationRef.current += 1;
    setSyncing(true);
    setSingleError(null);
    try {
      const res = await fetch(`/api/mercadolivre/${account.id}/sync`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.job_id) {
        syncFinishHandledRef.current = null;
        syncStallPollsRef.current = 0;
        syncLastProcessedRef.current = null;
        applyTrackedJob({
          id: data.job_id,
          status: "queued",
          total: 0,
          processed: 0,
          ok: 0,
          errors: 0,
          phase: "listing",
        });
      } else {
        setSyncing(false);
        forgetSyncJob();
        alert(data.error || "Erro ao iniciar sincronização");
      }
    } catch {
      setSyncing(false);
      forgetSyncJob();
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

  function handleApplyFilters(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setStatusFilter(statusDraft);
    setListingTypeFilter(listingTypeDraft);
    setFullOnly(fullOnlyDraft);
    setMlbuOnly(mlbuOnlyDraft);
    setMlbuCodeFilter(mlbuCodeDraft.trim());
    setMlAlertFilter(mlAlertDraft);
    setStockOpFilter(stockOpDraft);
    setStockQtyFilter(stockQtyDraft.trim());
    setSoldOpFilter(soldOpDraft);
    setSoldQtyFilter(soldQtyDraft.trim());
    setPage(1);
    setFiltersModalOpen(false);
  }

  const totalPages = computeTotalPages(total, pageSize);

  const appliedFilters = useMemo(() => {
    const filters: string[] = [];
    if (search) filters.push(`Busca: ${search}`);
    if (statusFilter) {
      filters.push(`Status: ${formatMlItemStatusLabel(statusFilter)}`);
    }
    if (listingTypeFilter) {
      filters.push(`Tipo: ${formatListingTypeLabel(listingTypeFilter)}`);
    }
    if (fullOnly) filters.push("Somente Full");
    if (mlbuOnly) filters.push("Somente MLBU");
    if (mlbuCodeFilter.trim()) filters.push(`Cód. MLBU: ${mlbuCodeFilter.trim()}`);
    if (mlAlertFilter) {
      const opt = ML_ALERT_FILTER_OPTIONS.find((o) => o.value === mlAlertFilter);
      filters.push(`Alertas ML: ${opt?.label ?? mlAlertFilter}`);
    }
    if (stockOpFilter) {
      const qty = parseInt(stockQtyFilter.trim(), 10);
      if (Number.isFinite(qty) && qty >= 0) {
        filters.push(`Estoque ${stockCompareLabel(stockOpFilter)} ${qty}`);
      }
    }
    if (soldOpFilter) {
      const qty = parseInt(soldQtyFilter.trim(), 10);
      if (Number.isFinite(qty) && qty >= 0) {
        filters.push(`Vendidos ${stockCompareLabel(soldOpFilter)} ${qty}`);
      }
    }
    return filters;
  }, [
    listingTypeFilter,
    fullOnly,
    mlbuCodeFilter,
    mlbuOnly,
    mlAlertFilter,
    search,
    statusFilter,
    stockOpFilter,
    stockQtyFilter,
    soldOpFilter,
    soldQtyFilter,
  ]);

  function clearFilters() {
    setSearch("");
    setSearchInput("");
    setStatusFilter("");
    setStatusDraft("");
    setListingTypeFilter("");
    setListingTypeDraft("");
    setFullOnly(false);
    setFullOnlyDraft(false);
    setMlbuOnly(false);
    setMlbuOnlyDraft(false);
    setMlbuCodeFilter("");
    setMlbuCodeDraft("");
    setMlAlertFilter("");
    setMlAlertDraft("");
    setStockOpFilter("");
    setStockOpDraft("");
    setStockQtyFilter("");
    setStockQtyDraft("");
    setSoldOpFilter("");
    setSoldOpDraft("");
    setSoldQtyFilter("");
    setSoldQtyDraft("");
    setPage(1);
  }

  function exportCurrentRows() {
    const headers = [
      "MLB",
      "Título",
      "Tipo de anúncio",
      "É Full",
      "Estoque Full",
      "Categoria",
      "Status",
      "Preço ML",
      "Preço trabalhado",
      "Estoque",
      "Vendidos",
      "Saúde",
      "MLBU",
      "Alertas ML",
      "Atualizado",
    ];
    const rows = sortedItems.map((item) => {
      const fulfillment = getItemFulfillment(item);
      const criticalTags = filterCriticalMlItemTags(parseMlItemTags(item.tags_json));
      return [
      item.item_id,
      item.title ?? "",
      formatListingTypeLabel(item.listing_type_id) || (item.listing_type_id ?? ""),
      fulfillment.is_fulfillment ? "Sim" : "Não",
      fulfillment.fulfillment_stock != null ? String(fulfillment.fulfillment_stock) : "",
      item.category_id ?? "",
      formatMlItemStatusLabel(item.status),
      item.price != null ? Number(item.price).toFixed(2) : "",
      (() => {
        const w = itemWorkedPrice(item);
        return w != null ? w.toFixed(2) : "";
      })(),
      item.available_quantity != null ? String(item.available_quantity) : "",
      item.sold_quantity != null ? String(item.sold_quantity) : "",
      formatMlItemHealth(item.health),
      item.user_product_id ?? "",
      criticalTags.map(formatMlItemTagLabel).join(", "),
      item.updated_at ? new Date(item.updated_at).toLocaleString() : "",
    ];
    });
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
      const av =
        sortField === "sale_price"
          ? itemWorkedPrice(a)
          : (a[sortField] as string | number | null | undefined);
      const bv =
        sortField === "sale_price"
          ? itemWorkedPrice(b)
          : (b[sortField] as string | number | null | undefined);

      if (av == null && bv == null) return 0;
      if (av == null) return 1 * dir;
      if (bv == null) return -1 * dir;

      if (
        sortField === "price" ||
        sortField === "sale_price" ||
        sortField === "available_quantity" ||
        sortField === "sold_quantity" ||
        sortField === "health"
      ) {
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
      : "sticky-col-surface";
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
      <div className="card p-6">
        <p className="text-slate-500">Carregando…</p>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm dark:border-amber-800 dark:bg-amber-950/50">
        <p className="text-amber-800 dark:text-amber-100">
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
      <div className="table-page-shell">
        <div className="table-page-toolbar">
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
          <div className="table-page-filters">
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
            <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-card px-2 py-1.5 text-xs text-slate-700 shadow-sm dark:border-slate-600 dark:text-slate-200">
              <span className="text-[11px] font-medium text-slate-600">Incluir por MLB</span>
              <input
                type="text"
                value={singleMlb}
                onChange={(e) => setSingleMlb(e.target.value)}
                placeholder="MLB123456789"
                className="pricing-inline-input w-28 px-2 py-1 text-[11px] font-mono"
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

        <div className="pricing-filter-bar">
          <div className="pricing-filter-bar-meta flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[12px]">
            <span className="pricing-filter-bar-label">Filtros:</span>
            {appliedFilters.length > 0 ? (
              appliedFilters.map((filter) => (
                <span key={filter} className="table-mini-control">
                  {filter}
                </span>
              ))
            ) : (
              <span className="text-slate-500 dark:text-slate-400">Nenhum filtro aplicado</span>
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
              onClick={() => {
                syncFilterDraftFromApplied();
                setFiltersModalOpen(true);
              }}
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

        {(singleError ||
          singleSyncing ||
          (syncing && job) ||
          (fulfillmentTracking && fulfillmentJob)) && (
          <div className="px-3 pb-3 pt-2">
            {singleError && <p className="mt-2 text-xs text-rose-600">{singleError}</p>}
            {singleSyncing && <SingleAnuncioImportBar />}
            {syncing && job && (
              <div className="mt-3">
                <SyncImportProgress
                  job={job}
                  tone="app"
                  actions={
                    job.status === "running" ||
                    (job.status === "failed" && isIncompleteJob(job)) ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await fetch(`/api/jobs/${job.id}`, { method: "PATCH" });
                          } finally {
                            setSyncing(false);
                            forgetSyncJob();
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
            {fulfillmentTracking && fulfillmentJob && (
              <div className={syncing && job ? "mt-2" : "mt-3"}>
                <SyncImportProgress
                  job={fulfillmentJob}
                  title="Estoque Full"
                  itemNoun="anúncios Full"
                  tone="app"
                  actions={
                    fulfillmentJob.status === "running" ||
                    (fulfillmentJob.status === "failed" && isIncompleteJob(fulfillmentJob)) ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await fetch(`/api/jobs/${fulfillmentJob.id}`, { method: "PATCH" });
                          } finally {
                            setFulfillmentTracking(false);
                            forgetFulfillmentJob();
                          }
                        }}
                        className="btn btn-secondary btn-mini"
                      >
                        Encerrar atualização Full
                      </button>
                    ) : undefined
                  }
                />
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Você já pode usar a tabela abaixo; esta etapa atualiza o estoque do depósito Mercado Livre em
                  segundo plano.
                </p>
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
                <TablePageSizeSelect
                  value={pageSize}
                  options={PAGE_SIZE_OPTIONS}
                  onChange={(next) => {
                    setPageSize(next);
                    setPage(1);
                    try {
                      localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(next));
                    } catch {
                      // ignore
                    }
                  }}
                />
                {totalPages > 1 && (
                  <>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Página {page}/{totalPages}</span>
                  <div className="table-pagination-group">
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
                  {renderColumnHeader("full", "Full")}
                  {renderColumnHeader("full_stock", "Estoque Full")}
                  {renderColumnHeader("category", "Categoria", "category_id")}
                  {renderColumnHeader("status", "Status", "status")}
                  {renderColumnHeader("price", "Preço ML", "price", "whitespace-nowrap")}
                  {renderColumnHeader(
                    "planned_price",
                    "Preço trab.",
                    "sale_price",
                    "whitespace-nowrap"
                  )}
                  {renderColumnHeader("stock", "Estoque", "available_quantity", "whitespace-nowrap")}
                  {renderColumnHeader("sold_quantity", "Vendidos", "sold_quantity", "whitespace-nowrap")}
                  {renderColumnHeader("health", "Saúde", "health", "whitespace-nowrap")}
                  {renderColumnHeader("mlbu", "MLBU", "user_product_id")}
                  {renderColumnHeader("ml_tags", "Alertas ML")}
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
                        "pricing-cell-chip font-mono text-xs"
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
                      className={frozenCellClass("full", "p-2 text-xs text-slate-700 dark:text-slate-200")}
                      style={frozenCellStyle("full")}
                    >
                      {isFullListing(item) ? (
                        <span className="inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-900 ring-1 ring-inset ring-emerald-300/90 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-700/90">
                          Sim
                        </span>
                      ) : (
                        <span className="text-fg-muted dark:text-slate-400">Não</span>
                      )}
                    </td>
                    <td
                      className={frozenCellClass("full_stock", "p-2 text-right text-xs tabular-nums text-slate-700 dark:text-slate-200")}
                      style={frozenCellStyle("full_stock")}
                      title={
                        formatFulfillmentStockTitle(item) ??
                        (isFullListing(item) && getItemFulfillment(item).fulfillment_stock == null
                          ? "Full confirmado por tag/frete; resincronize para obter o saldo no depósito ML"
                          : undefined)
                      }
                    >
                      {(() => {
                        const stock = getItemFulfillment(item).fulfillment_stock;
                        if (stock != null) return <span className="font-medium">{stock}</span>;
                        if (isFullListing(item)) {
                          return <span className="text-fg-muted dark:text-slate-500">—</span>;
                        }
                        return <span className="text-fg-muted dark:text-slate-400">—</span>;
                      })()}
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
                      <span className={mlItemStatusBadgeClass(item.status)} title={item.status ?? undefined}>
                        {formatMlItemStatusLabel(item.status)}
                      </span>
                    </td>
                    <td
                      className={frozenCellClass("price", "p-2 text-right text-sm tabular-nums text-slate-600 dark:text-slate-300")}
                      style={frozenCellStyle("price")}
                      title="Preço standard cadastrado no ML (sem promoção)"
                    >
                      {item.price != null ? Number(item.price).toFixed(2) : "—"}
                    </td>
                    <td
                      className={frozenCellClass(
                        "planned_price",
                        `p-2 text-right text-sm font-semibold tabular-nums ${
                          (() => {
                            const w = itemWorkedPrice(item);
                            return w != null &&
                              item.price != null &&
                              w !== Number(item.price)
                              ? "text-[#018589] dark:text-teal-300"
                              : "text-slate-800 dark:text-slate-100";
                          })()
                        }`
                      )}
                      style={frozenCellStyle("planned_price")}
                      title="Preço exibido no anúncio (sale_price do ML)"
                    >
                      {(() => {
                        const w = itemWorkedPrice(item);
                        return w != null ? w.toFixed(2) : "—";
                      })()}
                    </td>
                    <td
                      className={frozenCellClass(
                        "stock",
                        `p-2 text-right text-sm font-medium tabular-nums ${
                          item.available_quantity === 0
                            ? "text-amber-700 dark:text-amber-300"
                            : "text-slate-800 dark:text-slate-100"
                        }`
                      )}
                      style={frozenCellStyle("stock")}
                      title={formatListingStockTitle(item) ?? "Quantidade total disponível para venda (Full + próprio/Flex)"}
                    >
                      {item.available_quantity != null ? item.available_quantity : "—"}
                    </td>
                    <td
                      className={frozenCellClass(
                        "sold_quantity",
                        "p-2 text-right text-sm tabular-nums text-slate-700 dark:text-slate-200"
                      )}
                      style={frozenCellStyle("sold_quantity")}
                      title="Unidades vendidas no Mercado Livre"
                    >
                      {item.sold_quantity != null ? item.sold_quantity : "—"}
                    </td>
                    <td
                      className={frozenCellClass(
                        "health",
                        `p-2 text-right text-sm tabular-nums ${mlItemHealthClass(item.health)}`
                      )}
                      style={frozenCellStyle("health")}
                      title="Qualidade do anúncio no ML (health)"
                    >
                      {formatMlItemHealth(item.health)}
                    </td>
                    <td
                      role={item.user_product_id ? "button" : undefined}
                      tabIndex={item.user_product_id ? 0 : undefined}
                      onClick={
                        item.user_product_id ? () => copyMlbu(item.user_product_id!) : undefined
                      }
                      onKeyDown={
                        item.user_product_id
                          ? (e) => e.key === "Enter" && copyMlbu(item.user_product_id!)
                          : undefined
                      }
                      className={frozenCellClass(
                        "mlbu",
                        `max-w-[140px] p-2 font-mono text-xs ${
                          item.user_product_id ? "pricing-cell-chip cursor-pointer" : ""
                        }`
                      )}
                      style={frozenCellStyle("mlbu")}
                      title={item.user_product_id ? "Clique para copiar MLBU" : undefined}
                    >
                      {item.user_product_id ? (
                        copiedMlbu === item.user_product_id ? (
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">Copiado!</span>
                        ) : (
                          <span className="truncate">{item.user_product_id}</span>
                        )
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </td>
                    <td
                      className={frozenCellClass("ml_tags", "max-w-[220px] p-2")}
                      style={frozenCellStyle("ml_tags")}
                    >
                      {(() => {
                        const critical = filterCriticalMlItemTags(parseMlItemTags(item.tags_json));
                        if (critical.length === 0) {
                          return <span className="text-xs text-slate-400 dark:text-slate-500">—</span>;
                        }
                        return (
                          <div className="flex flex-wrap gap-1">
                            {critical.map((tag) => (
                              <span
                                key={tag}
                                title={tag}
                                className={mlItemTagBadgeClass(tag)}
                              >
                                {formatMlItemTagLabel(tag)}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                    <td
                      className={frozenCellClass("variations", "p-2 text-xs text-slate-700 dark:text-slate-200")}
                      style={frozenCellStyle("variations")}
                    >
                      {item.has_variations ? (
                        <span className="inline-flex items-center rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-900 ring-1 ring-inset ring-sky-300/90 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-700/90">
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
            className="modal-panel w-full max-w-lg"
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
                className="rounded border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                aria-label="Fechar filtros"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleApplyFilters} className="space-y-4 p-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Buscar
                </label>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Título, MLB ou família…"
                  className="input"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </label>
                  <select
                    value={statusDraft}
                    onChange={(e) => setStatusDraft(e.target.value)}
                    className="input"
                  >
                    <option value="">Todos os status</option>
                    {ML_ITEM_STATUS_FILTER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tipo de anúncio
                  </label>
                  <select
                    value={listingTypeDraft}
                    onChange={(e) => setListingTypeDraft(e.target.value)}
                    className="input"
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
                    value={mlbuCodeDraft}
                    onChange={(e) => setMlbuCodeDraft(e.target.value)}
                    placeholder="ex: MLAU123"
                    className="input font-mono"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 rounded border border-slate-200 bg-card px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={fullOnlyDraft}
                  onChange={(e) => setFullOnlyDraft(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0d6efd] focus:ring-[#0d6efd]"
                />
                Mostrar somente anúncios Full
              </label>

              <label className="flex items-center gap-2 rounded border border-slate-200 bg-card px-3 py-2 text-sm text-slate-700 dark:border-slate-600 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={mlbuOnlyDraft}
                  onChange={(e) => setMlbuOnlyDraft(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0d6efd] focus:ring-[#0d6efd]"
                />
                Mostrar somente anúncios com MLBU
              </label>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Alertas ML
                </label>
                <select
                  value={mlAlertDraft}
                  onChange={(e) => setMlAlertDraft(e.target.value)}
                  className="input"
                >
                  <option value="">Todos</option>
                  {ML_ALERT_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Estoque
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="anuncios-stock-op"
                    className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                  >
                    Condição
                  </label>
                  <select
                    id="anuncios-stock-op"
                    value={stockOpDraft}
                    onChange={(e) => setStockOpDraft(e.target.value as StockCompareOp | "")}
                    className="input w-full"
                  >
                    <option value="">Sem filtro de estoque</option>
                    {STOCK_COMPARE_OPS.map((op) => (
                      <option key={op} value={op}>
                        {stockCompareLabel(op)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="anuncios-stock-qty"
                    className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                  >
                    Quantidade
                  </label>
                  <input
                    id="anuncios-stock-qty"
                    type="number"
                    min={0}
                    step={1}
                    value={stockQtyDraft}
                    onChange={(e) => setStockQtyDraft(e.target.value)}
                    disabled={!stockOpDraft}
                    placeholder={stockOpDraft ? "Ex.: 10" : "Escolha a condição"}
                    className="input w-full disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                {stockOpDraft && stockQtyDraft.trim() === "" && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">
                    Informe a quantidade para aplicar o filtro de estoque.
                  </p>
                )}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Vendidos
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="anuncios-sold-op"
                      className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                    >
                      Condição
                    </label>
                    <select
                      id="anuncios-sold-op"
                      value={soldOpDraft}
                      onChange={(e) => setSoldOpDraft(e.target.value as StockCompareOp | "")}
                      className="input w-full"
                    >
                      <option value="">Sem filtro de vendidos</option>
                      {STOCK_COMPARE_OPS.map((op) => (
                        <option key={op} value={op}>
                          {stockCompareLabel(op)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="anuncios-sold-qty"
                      className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300"
                    >
                      Quantidade
                    </label>
                    <input
                      id="anuncios-sold-qty"
                      type="number"
                      min={0}
                      step={1}
                      value={soldQtyDraft}
                      onChange={(e) => setSoldQtyDraft(e.target.value)}
                      disabled={!soldOpDraft}
                      placeholder={soldOpDraft ? "Ex.: 5" : "Escolha a condição"}
                      className="input w-full disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                  {soldOpDraft && soldQtyDraft.trim() === "" && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">
                      Informe a quantidade para aplicar o filtro de vendidos.
                    </p>
                  )}
                </div>
              </div>

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
