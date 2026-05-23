"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AppTable } from "@/components/AppTable";
import type { ProductTag } from "@/lib/db/types";
import { TablePageSizeSelect } from "@/components/TablePageSizeSelect";
import { OnboardingGate } from "@/components/OnboardingGate";
import {
  apiListPage,
  computeTotalPages,
  TABLE_PAGE_SIZE_OPTIONS,
} from "@/lib/table-pagination";
import { ReceivableModal } from "@/components/ReceivableModal";
import { SmartLoaderOverlay } from "@/components/SmartLoaderOverlay";
import { normalizeTiers, validateTiers, type Tier } from "@/lib/atacado";
import { CSV_HEADER_EXACT } from "@/lib/atacado-import-csv";

interface ImportPreviewRow {
  row: number;
  item_id: string;
  variation_id: string;
  sku: string;
  title: string;
  price_atual: string;
  promocao: string;
  tiers: Tier[];
  valid: boolean;
  error?: string;
}

interface ValidItemForConfirm {
  item_id: string;
  variation_id: number | null;
  tiers: Tier[];
}

interface ImportResult {
  ok: boolean;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  errors: { row: number; field?: string; message: string }[];
  preview: ImportPreviewRow[];
  valid_items?: ValidItemForConfirm[];
}

interface MLAccount {
  id: string;
  ml_nickname: string | null;
}

interface AtacadoRow {
  item_id: string;
  variation_id: number | null;
  sku: string | null;
  title: string | null;
  current_price: number | null;
  /** Preço promoção / calculadora (planned_prices) */
  planned_price?: number | null;
  listing_type_id?: string | null;
  category_id?: string | null;
  tiers: Tier[];
  has_draft: boolean;
  has_variations: boolean;
  draft_updated_at: string | null;
  /** Nome da família (modelo User Product); null para itens clássicos */
  family_name?: string | null;
  /** true = anúncio do modelo User Product (MLBU) */
  is_user_product?: boolean;
  /** Código MLBU (user_product_id) */
  user_product_id?: string | null;
  family_id?: string | null;
  /** Itens da mesma família (item_ids) */
  family_item_ids?: string[] | null;
}

const ATACADO_STICKY_STORAGE_KEY = "escalapreco.atacado.pinnedColumns.v5";
/** Mesma chave do layout / Anúncios — conta ativa no painel */
const DASHBOARD_ACCOUNT_STORAGE_KEY = "escalapreco_dashboard_account_id";

/** Larguras mínimas (px): alinhadas ao `<colgroup>` para `position: sticky` e `left`. */
const ATACADO_COLUMNS: { minWidth: number }[] = [
  /** MLB (13 caracteres em mono) + padding do chip e da célula */
  { minWidth: 136 },
  { minWidth: 180 },
  { minWidth: 120 },
  { minWidth: 88 },
  { minWidth: 96 },
  { minWidth: 92 },
  { minWidth: 92 },
  { minWidth: 92 },
  { minWidth: 92 },
  { minWidth: 92 },
  { minWidth: 92 },
  { minWidth: 92 },
  { minWidth: 92 },
  { minWidth: 92 },
  { minWidth: 92 },
  { minWidth: 100 },
  { minWidth: 128 },
];

/** Soma das larguras do `<colgroup>`: tabela com esta largura evita redistribuição em `table-fixed` que deslocava `left` das colunas sticky. */
const ATACADO_TABLE_TOTAL_WIDTH_PX = ATACADO_COLUMNS.reduce((s, c) => s + c.minWidth, 0);

const ATACADO_STATUS_COL_INDEX = ATACADO_COLUMNS.length - 2;
const ATACADO_ACTIONS_COL_INDEX = ATACADO_COLUMNS.length - 1;

function isValidAtacadoColIndex(colIndex: number): boolean {
  return Number.isInteger(colIndex) && colIndex >= 0 && colIndex < ATACADO_COLUMNS.length;
}

function atacadoColWidth(colIndex: number): number {
  return ATACADO_COLUMNS[colIndex]?.minWidth ?? 0;
}

function sanitizeAtacadoStickyColumns(cols: Set<number>): Set<number> {
  return new Set(Array.from(cols).filter((j) => isValidAtacadoColIndex(j)));
}

function readAtacadoStickyInitial(): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(ATACADO_STICKY_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    const n = ATACADO_COLUMNS.length;
    const nums = arr.filter(
      (x): x is number =>
        typeof x === "number" && Number.isInteger(x) && x >= 0 && x < n
    );
    return sanitizeAtacadoStickyColumns(new Set(nums));
  } catch {
    return new Set();
  }
}

function AtacadoIconButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-md p-1 text-fg hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-600/80 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

type RowStatus = "saved" | "edited" | "error";

const ATACADO_SLOT_COUNT = 5;

type RowEditState = {
  /** Faixas na ordem das colunas (índice 0 = «Qt. Atac. 1»). Não reordenar por min_qty — evita trocar preços de coluna. */
  slots: (Tier | null)[];
  status: RowStatus;
  error?: string;
};

function padSlots5(slots: (Tier | null)[] | undefined): (Tier | null)[] {
  const s = slots ?? [];
  const out: (Tier | null)[] = s.slice(0, ATACADO_SLOT_COUNT);
  while (out.length < ATACADO_SLOT_COUNT) out.push(null);
  return out;
}

function rowTiersToSlots(tiers: Tier[]): (Tier | null)[] {
  const out: (Tier | null)[] = Array(ATACADO_SLOT_COUNT).fill(null);
  for (let i = 0; i < Math.min(ATACADO_SLOT_COUNT, tiers.length); i++) {
    out[i] = tiers[i] ?? null;
  }
  return out;
}

function defaultRowEditState(r: AtacadoRow): RowEditState {
  return { slots: rowTiersToSlots(r.tiers), status: "saved" };
}

function nonNullTiersInSlotOrder(slots: (Tier | null)[]): Tier[] {
  return padSlots5(slots).filter((x): x is Tier => x != null);
}

/** Quantidades mínimas estritamente crescentes da esquerda para a direita (só slots não nulos). */
function minQtyStrictlyOrderedInSlots(slots: (Tier | null)[]): boolean {
  let last = -Infinity;
  for (const t of padSlots5(slots)) {
    if (t == null) continue;
    if (typeof t.min_qty !== "number" || !Number.isInteger(t.min_qty)) return false;
    if (t.min_qty <= last) return false;
    last = t.min_qty;
  }
  return true;
}

function bulkBasePrice(r: AtacadoRow, base: "current" | "promotion"): number | null {
  if (base === "current") {
    if (r.current_price == null) return null;
    const n = Number(r.current_price);
    return !Number.isNaN(n) && n > 0 ? n : null;
  }
  if (r.planned_price == null || Number.isNaN(Number(r.planned_price))) return null;
  const n = Number(r.planned_price);
  return n > 0 ? n : null;
}

/** Valor usado nas condições (promoção = planned_prices; atual = ML). */
function bulkCompareFieldValue(r: AtacadoRow, field: "promotion" | "current"): number | null {
  return bulkBasePrice(r, field);
}

function parseBulkPercentInput(s: string): number | null {
  const pct = parseFloat(s.trim().replace(",", "."));
  if (Number.isNaN(pct) || pct < 0 || pct > 100) return null;
  return pct;
}

function parseBulkThresholdInput(s: string): number | null {
  const n = parseFloat(s.trim().replace(",", "."));
  if (Number.isNaN(n) || n < 0) return null;
  return n;
}

type BulkDiscountCompareOp = "gt" | "gte" | "lt" | "lte" | "eq";

function bulkConditionalPasses(compareVal: number, th: number, op: BulkDiscountCompareOp): boolean {
  switch (op) {
    case "gt":
      return compareVal > th;
    case "gte":
      return compareVal >= th;
    case "lt":
      return compareVal < th;
    case "lte":
      return compareVal <= th;
    case "eq":
      return Math.round(compareVal * 100) === Math.round(th * 100);
    default:
      return false;
  }
}

interface BulkDiscountConditional {
  id: string;
  op: BulkDiscountCompareOp;
  compareField: "promotion" | "current";
  thresholdStr: string;
  discountStr: string;
  discountBase: "current" | "promotion";
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

function AtacadoHelpContent() {
  return (
    <div className="space-y-6 text-sm text-slate-700 dark:text-slate-300">
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
            Evita erros comuns e retrabalho. Salvar rascunho no sistema não altera o Mercado Livre; só{" "}
            <strong>Aplicar no Mercado Livre</strong> envia os preços. Reserve 2 minutos nesta aba antes de importar ou
            aplicar em massa.
          </p>
        </div>
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0d6efd]/10 text-lg dark:bg-[#0d6efd]/25"
            aria-hidden
          >
            📦
          </span>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Para que serve esta tela</h2>
        </div>
        <p>
          A tela <strong>Atacado</strong> cadastra e ajusta até <strong>cinco faixas de preço por quantidade</strong>{" "}
          por anúncio (um MLB por linha): quantidade mínima em <strong>Qt. Atac.</strong> e preço em{" "}
          <strong>R$ Atac.</strong>
        </p>
        <p>
          Ao clicar em <strong>Salvar alterações</strong>, os valores ficam gravados como rascunho no sistema. Ao clicar
          em <strong>Aplicar no Mercado Livre</strong>, os preços salvos são enviados ao ML (alterações ainda não salvas
          são salvas automaticamente antes do envio).
        </p>
        <p className="text-slate-600 dark:text-slate-400">
          <strong>Pré-requisito:</strong> anúncios já sincronizados na conta ativa. Se a tabela estiver vazia, abra a
          aba <strong>Anúncios</strong> e use <strong>Importar / sincronizar todos</strong>, ou confira a conta no menu
          superior.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Passo a passo</h2>
        <ol className="list-decimal space-y-2.5 pl-5 marker:font-semibold marker:text-[#0d6efd]">
          <li>
            Abra a aba <strong>Atacado</strong> e confirme a conta ML no menu superior. Use o ícone de{" "}
            <strong>funil</strong>, preencha o modal <strong>Filtros</strong> se quiser refinar e clique em{" "}
            <strong>Aplicar filtros</strong>.
          </li>
          <li>
            Edite <strong>Qt. Atac. 1–5</strong> e <strong>R$ Atac. 1–5</strong> na tabela (cada quantidade preenchida
            deve ser maior que a da coluna à esquerda). Use <strong>Preço R$</strong> e <strong>Promoção R$</strong> só
            como referência.
          </li>
          <li>
            Clique em <strong>Salvar alterações</strong> para gravar os rascunhos das linhas alteradas nesta página.
          </li>
          <li>
            Clique em <strong>Aplicar no Mercado Livre</strong> para enviar ao ML os preços de atacado já salvos nos
            itens elegíveis.
          </li>
          <li>
            Para trabalhar em lote, clique em <strong>Importar CSV</strong>, depois em{" "}
            <strong>Selecionar arquivo…</strong>, revise o preview e clique em <strong>Confirmar Importação</strong>; ou
            use <strong>Exportar CSV</strong> para editar na planilha.
          </li>
          <li>
            Para trazer faixas do ML para o rascunho (substituindo edições locais), clique em{" "}
            <strong>Importar do ML</strong> e confirme. No menu <strong>⋮</strong>, use{" "}
            <strong>Atualizar tabela</strong> para recarregar a lista com os mesmos filtros.
          </li>
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Campos e o que significam</h2>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Barra de ações (aba Atacado)
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="required" name="Salvar alterações">
              Grava no banco as edições da página atual; só linhas com status alterado. Não envia nada ao Mercado Livre.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Importar CSV">
              Abre o modal de importação; arquivo UTF-8 com separador <strong>;</strong> e cabeçalho igual ao de{" "}
              <strong>Exportar CSV</strong>.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Exportar CSV">
              Baixa planilha com MLB, SKU, preços de referência e colunas de atacado 1–5 da conta/filtros atuais.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Importar do ML">
              Substitui os rascunhos pelas faixas que estão hoje no Mercado Livre (confirmação obrigatória).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Aplicar no Mercado Livre">
              Envia ao ML os preços de atacado salvos; pode exibir painel de progresso com erros por linha.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Ações em massa">
              Menu com <strong>Editar quantidade mínima…</strong>, <strong>Preço com desconto %…</strong> e{" "}
              <strong>Limpar todas as colunas de atacado…</strong> — afeta só as linhas visíveis nesta página.
            </HelpFieldRow>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Modal Filtros (ícone de funil)
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="optional" name="MLB">
              Código do anúncio (ex.: MLB1234567890); busca parcial ou exata se o código estiver completo.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="MLBU">
              Código User Product; busca parcial no campo sincronizado.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Título">
              Texto livre no título do anúncio; correspondência parcial.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="SKU">
              Filtra pelo SKU (atributo SELLER_SKU do item ou variação).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Refino">
              Opções: Nenhum, Só MLBU, Com família, Com rascunho, Sem rascunho, Preço alto (ref.).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Tags do produto vinculado (qualquer uma)">
              Exibe linhas cujo produto vinculado tenha pelo menos uma das tags marcadas.
            </HelpFieldRow>
            <HelpFieldRow kind="required" name="Aplicar filtros">
              Confirma o modal e recarrega a tabela; sem este clique, nada do modal entra em vigor.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Limpar filtros">
              Zera filtros aplicados e campos do modal (botão no rodapé do modal, quando visível).
            </HelpFieldRow>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Colunas editáveis (tabela)
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="optional" name="Qt. Atac. 1–5">
              Quantidade mínima inteira ≥ 2; cada coluna preenchida deve ser maior que todas à esquerda. Pode ficar vazia
              se a faixa não for usada.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="R$ Atac. 1–5">
              Preço unitário da faixa; use vírgula ou ponto para decimais. Obrigatório &gt; 0 quando a quantidade da mesma
              faixa estiver preenchida.
            </HelpFieldRow>
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Colunas de referência e ações por linha
          </h3>
          <div className="space-y-2">
            <HelpFieldRow kind="optional" name="MLB">
              Código do anúncio; clique na célula para copiar.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Preço R$">
              Preço atual no Mercado Livre (somente leitura).
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Promoção R$">
              Preço planejado na calculadora (<strong>Preços</strong>); referência para descontos em massa.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Status">
              Indica se a linha está salva, alterada ou com erro de validação.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Salvar linha (ícone)">
              Grava só aquela linha, equivalente a <strong>Salvar alterações</strong> para um MLB.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Reverter alterações desta linha (ícone)">
              Descarta edições locais e restaura o último rascunho salvo.
            </HelpFieldRow>
            <HelpFieldRow kind="optional" name="Ver recebível (ícone)">
              Abre estimativa de taxas ML e valor líquido por cenário de preço/atacado.
            </HelpFieldRow>
          </div>
        </div>
      </section>
    </div>
  );
}

function AtacadoPageContent() {
  const [accounts, setAccounts] = useState<MLAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [accountId, setAccountId] = useState<string>("");
  const [rows, setRows] = useState<AtacadoRow[]>([]);
  const [edits, setEdits] = useState<Record<string, RowEditState>>({});
  const [total, setTotal] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loadingRows, setLoadingRows] = useState(true);
  const [rowsFetchError, setRowsFetchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  
  /** Modal de filtros (mesmo padrão da tela Anúncios) */
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [atacadoTab, setAtacadoTab] = useState<"lista" | "como-funciona">("lista");
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const optionsMenuRef = useRef<HTMLDivElement>(null);
  const [draftMlb, setDraftMlb] = useState("");
  const [draftMlbu, setDraftMlbu] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSku, setDraftSku] = useState("");
  const [draftFilterExtra, setDraftFilterExtra] = useState("");
  const [draftFilterTagIds, setDraftFilterTagIds] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<ProductTag[]>([]);
  const [filtersApplied, setFiltersApplied] = useState<{
    mlb: string;
    mlbu: string;
    title: string;
    sku: string;
    filterExtra: string;
    tagIds: string[];
  }>({
    mlb: "",
    mlbu: "",
    title: "",
    sku: "",
    filterExtra: "",
    tagIds: [],
  });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importCsvModalOpen, setImportCsvModalOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);
  const [seedFromMlLoading, setSeedFromMlLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [applyJobId, setApplyJobId] = useState<string | null>(null);
  const [applyJob, setApplyJob] = useState<{
    job: { id: string; status: string; total: number; processed: number; ok: number; errors: number };
    logs: Array<{ item_id: string | null; variation_id: number | null; status: string; message: string | null; response_json?: unknown }>;
  } | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);

  /** Texto digitado no campo de preço (por linha e tier) para permitir decimais com vírgula enquanto digita */
  const [editingPrice, setEditingPrice] = useState<Record<string, string>>({});
  const [editingMinQty, setEditingMinQty] = useState<Record<string, string>>({});

  /** Célula que acabou de ser copiada (ex: "mlb:MLB123:item") para mostrar "Copiado!" */
  const [copiedCell, setCopiedCell] = useState<string | null>(null);

  /** Linha cujo modal "Ver recebível" está aberto (rowKey ou null) */
  const [receivableRowKey, setReceivableRowKey] = useState<string | null>(null);

  /** Regras em massa (somente linhas da página atual) */
  const [bulkTierIdx, setBulkTierIdx] = useState(0);
  const [bulkMinQtyStr, setBulkMinQtyStr] = useState("2");
  const [bulkDiscountStr, setBulkDiscountStr] = useState("5");
  const [bulkPriceBase, setBulkPriceBase] = useState<"current" | "promotion">("current");
  /** Critérios opcionais avaliados em ordem; o primeiro que bater define % e base do desconto. */
  const [bulkDiscountConditionals, setBulkDiscountConditionals] = useState<BulkDiscountConditional[]>([]);
  const [bulkActionsMenuOpen, setBulkActionsMenuOpen] = useState(false);
  const [bulkMinQtyModalOpen, setBulkMinQtyModalOpen] = useState(false);
  const [bulkDiscountModalOpen, setBulkDiscountModalOpen] = useState(false);
  const bulkActionsRef = useRef<HTMLDivElement>(null);

  const tagNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allTags) m.set(t.id, t.name);
    return m;
  }, [allTags]);

  const loadAllTags = useCallback(async () => {
    try {
      const res = await fetch("/api/product-tags");
      if (res.ok) {
        const data = await res.json();
        setAllTags((data.tags ?? []) as ProductTag[]);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void loadAllTags();
  }, [loadAllTags]);

  const appliedAtacadoFilterLabels = useMemo(() => {
    const chips: string[] = [];
    if (filtersApplied.mlb.trim()) chips.push(`MLB: ${filtersApplied.mlb.trim()}`);
    if (filtersApplied.mlbu.trim()) chips.push(`MLBU: ${filtersApplied.mlbu.trim()}`);
    if (filtersApplied.title.trim()) chips.push(`Título: ${filtersApplied.title.trim()}`);
    if (filtersApplied.sku.trim()) chips.push(`SKU: ${filtersApplied.sku.trim()}`);
    if (filtersApplied.filterExtra) {
      const map: Record<string, string> = {
        mlbu: "Refino: só MLBU",
        com_familia: "Refino: com família",
        com_rascunho: "Refino: com rascunho",
        sem_rascunho: "Refino: sem rascunho",
        price_high: "Refino: preço alto",
      };
      chips.push(map[filtersApplied.filterExtra] ?? `Refino: ${filtersApplied.filterExtra}`);
    }
    for (const id of filtersApplied.tagIds) {
      const name = tagNameById.get(id);
      if (name) chips.push(`Tag: ${name}`);
    }
    return chips;
  }, [filtersApplied, tagNameById]);

  const searchParams = useSearchParams();
  const rowKey = (r: AtacadoRow) => `${r.item_id}:${r.variation_id ?? "item"}`;

  const [stickyColumns, setStickyColumns] = useState<Set<number>>(() => new Set());
  const [stickyHydrated, setStickyHydrated] = useState(false);
  const [headerMenuColIndex, setHeaderMenuColIndex] = useState<number | null>(null);
  const atacadoTheadRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    setStickyColumns(sanitizeAtacadoStickyColumns(readAtacadoStickyInitial()));
    setStickyHydrated(true);
  }, []);

  useEffect(() => {
    if (headerMenuColIndex === null) return;
    const close = (e: MouseEvent) => {
      if (atacadoTheadRef.current && !atacadoTheadRef.current.contains(e.target as Node)) {
        setHeaderMenuColIndex(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [headerMenuColIndex]);

  const toggleStickyColumn = useCallback((colIndex: number) => {
    if (!isValidAtacadoColIndex(colIndex)) return;
    setStickyColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colIndex)) next.delete(colIndex);
      else next.add(colIndex);
      return next;
    });
    setHeaderMenuColIndex(null);
  }, []);

  const { stickyHeaderStyles, stickyBodyStyles } = useMemo(() => {
    const len = ATACADO_COLUMNS.length;
    const head: (CSSProperties | undefined)[] = Array.from({ length: len }, () => undefined);
    const body: (CSSProperties | undefined)[] = Array.from({ length: len }, () => undefined);
    const pinnedColumns = sanitizeAtacadoStickyColumns(stickyColumns);
    /** Mesma ideia que `frozenColumnLeft` em Anúncios: soma só colunas pinadas à esquerda deste índice. */
    const stickyLeft = (colIndex: number) =>
      Array.from(pinnedColumns)
        .filter((j) => j < colIndex)
        .reduce((sum, j) => sum + atacadoColWidth(j), 0);
    let order = 0;
    for (let i = 0; i < len; i++) {
      if (pinnedColumns.has(i)) {
        const w = atacadoColWidth(i);
        if (w <= 0) continue;
        const left = stickyLeft(i);
        const base = {
          position: "sticky" as const,
          left,
          width: w,
          minWidth: w,
          maxWidth: w,
          boxSizing: "border-box" as const,
        };
        head[i] = { ...base, zIndex: 30 + order };
        body[i] = { ...base, zIndex: 2 + order };
        order++;
      }
    }
    return { stickyHeaderStyles: head, stickyBodyStyles: body };
  }, [stickyColumns]);

  useEffect(() => {
    if (!stickyHydrated) return;
    try {
      localStorage.setItem(
        ATACADO_STICKY_STORAGE_KEY,
        JSON.stringify(Array.from(stickyColumns).sort((a, b) => a - b))
      );
    } catch {
      // ignore quota / private mode
    }
  }, [stickyColumns, stickyHydrated]);

  function renderAtacadoHeaderMenu(colIndex: number) {
    if (headerMenuColIndex !== colIndex) return null;
    const pinned = stickyColumns.has(colIndex);
    return (
      <div className="btn-dropdown-menu left-1 top-full z-50 mt-1 w-48 normal-case tracking-normal shadow-xl">
        <button
          type="button"
          onClick={() => toggleStickyColumn(colIndex)}
          className="btn-dropdown-item"
        >
          {pinned ? "Descongelar coluna" : "Congelar coluna"}
        </button>
      </div>
    );
  }

  function renderAtacadoColumnHeader(
    colIndex: number,
    label: React.ReactNode,
    extraClass = "",
    thProps?: React.ThHTMLAttributes<HTMLTableCellElement>
  ) {
    const pinned = stickyColumns.has(colIndex);
    const { style: thExtraStyle, ...thRest } = thProps ?? {};
    return (
      <th
        className={`relative select-none p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/95 ${extraClass} ${pinned ? "sticky-col" : ""}`}
        style={{ ...thExtraStyle, ...(stickyHeaderStyles[colIndex] ?? {}) }}
        {...thRest}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setHeaderMenuColIndex((c) => (c === colIndex ? null : colIndex));
          }}
          className="inline-flex w-full items-center justify-between gap-1 rounded-sm text-left hover:bg-white/10"
          aria-expanded={headerMenuColIndex === colIndex}
        >
          <span className="min-w-0 truncate">{label}</span>
          <span className="shrink-0 text-[10px] text-white/65">▾</span>
        </button>
        {renderAtacadoHeaderMenu(colIndex)}
      </th>
    );
  }

  /** Renderiza uma linha editável */
  function renderAtacadoRow(r: AtacadoRow) {
    const cur = getEditState(r);
    const slots5 = padSlots5(cur.slots);
    const err = validateRow(r);
    const isInvalid = cur.status === "edited" && err != null;
    const stickyTd = (colIndex: number, className: string, children: React.ReactNode) => (
      <td
        className={`${className} ${stickyColumns.has(colIndex) ? "sticky-col" : ""}`}
        style={stickyBodyStyles[colIndex]}
      >
        {children}
      </td>
    );

    return (
      <tr
        key={rowKey(r)}
        className={`border-b border-gray-100 dark:border-slate-700 ${isInvalid ? "bg-red-50 dark:bg-red-950/30" : ""} hover:bg-gray-50 dark:hover:bg-slate-800/50`}
      >
        {stickyTd(
          0,
          "overflow-hidden p-2",
          <button
            type="button"
            onClick={() => copyToClipboard(r.item_id, `${rowKey(r)}-mlb`)}
            title="Clique para copiar"
            className="pricing-cell-chip inline-block max-w-full whitespace-nowrap py-0.5 text-left font-mono text-xs"
          >
            {copiedCell === `${rowKey(r)}-mlb` ? (
              <span className="text-xs font-medium text-emerald-600">Copiado!</span>
            ) : (
              r.item_id
            )}
          </button>
        )}
        {stickyTd(1, "max-w-[180px] truncate p-2", <span title={r.title ?? ""}>{r.title ?? "—"}</span>)}
        {stickyTd(
          2,
          "p-2 text-fg",
          r.sku ? (
            <button type="button" onClick={() => copyToClipboard(r.sku ?? "", `${rowKey(r)}-sku`)} title="Clique para copiar" className="hover:bg-gray-100 rounded px-1 py-0.5 -mx-1 text-left cursor-pointer max-w-full truncate block">
              {copiedCell === `${rowKey(r)}-sku` ? <span className="text-emerald-600 text-xs font-medium">Copiado!</span> : r.sku}
            </button>
          ) : (
            <span className="cursor-help text-amber-600" title="Configure SELLER_SKU no ML.">
              Não configurado
            </span>
          )
        )}
        {stickyTd(3, "p-2 tabular-nums", r.current_price != null ? Number(r.current_price).toFixed(2) : "—")}
        {stickyTd(
          4,
          "p-2 text-right tabular-nums",
          r.planned_price != null && !Number.isNaN(Number(r.planned_price)) ? Number(r.planned_price).toFixed(2) : "—"
        )}
        {[0, 1, 2, 3, 4].map((i) => {
          const priceInputKey = `${rowKey(r)}-${i}`;
          const minInputKey = `${rowKey(r)}-${i}`;
          const priceDisplay =
            editingPrice[priceInputKey] !== undefined
              ? editingPrice[priceInputKey]
              : slots5[i]?.price != null
                ? formatPriceDisplay(slots5[i]!.price)
                : "";
          const minQtyStr =
            editingMinQty[minInputKey] !== undefined
              ? editingMinQty[minInputKey]
              : slots5[i]?.min_qty != null
                ? String(slots5[i]!.min_qty)
                : "";
          const minCol = 5 + i * 2;
          const priceCol = 6 + i * 2;
          return (
            <React.Fragment key={i}>
              {stickyTd(
                minCol,
                "p-2",
                <input
                  type="text"
                  autoComplete="off"
                  placeholder={i === 0 ? "2" : ""}
                  value={minQtyStr}
                  onChange={(e) => setEditingMinQty((prev) => ({ ...prev, [minInputKey]: e.target.value }))}
                  onBlur={(e) => commitMinQtyBlur(r, i, e.target.value)}
                  className={`pricing-inline-input w-16 px-1 py-0.5 text-sm ${isInvalid ? "border-red-500" : ""}`}
                />
              )}
              {stickyTd(
                priceCol,
                "p-2",
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={priceDisplay}
                  onChange={(e) => setEditingPrice((prev) => ({ ...prev, [priceInputKey]: e.target.value }))}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const parsed = raw !== "" ? parsePriceInput(raw) : slots5[i]?.price ?? 0;
                    updateTierPrice(r, i, parsed);
                    setEditingPrice((prev) => {
                      const next = { ...prev };
                      delete next[priceInputKey];
                      return next;
                    });
                  }}
                  className={`pricing-inline-input w-20 px-1 py-0.5 text-sm ${isInvalid ? "border-red-500" : ""}`}
                />
              )}
            </React.Fragment>
          );
        })}
        {stickyTd(
          ATACADO_STATUS_COL_INDEX,
          "overflow-hidden p-2",
          <span className={`rounded px-2 py-0.5 text-xs ${cur.status === "error" ? "bg-red-200 text-red-800" : cur.status === "edited" ? "bg-amber-200 text-amber-800" : "bg-green-100 text-green-800"}`}>{cur.status === "error" ? "erro" : cur.status === "edited" ? "alterado" : "salvo"}</span>
        )}
        {stickyTd(
          ATACADO_ACTIONS_COL_INDEX,
          "overflow-hidden p-1.5",
          <div className="flex flex-nowrap items-center justify-center gap-0.5">
            <AtacadoIconButton label="Salvar linha" onClick={() => saveRow(r)} disabled={saving} className="text-primary hover:bg-primary/10 dark:hover:bg-primary/20">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            </AtacadoIconButton>
            <AtacadoIconButton label="Reverter alterações desta linha" onClick={() => revertRow(r)}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </AtacadoIconButton>
            <AtacadoIconButton label="Ver recebível (taxas e valor líquido por cenário)" onClick={() => setReceivableRowKey(rowKey(r))}>
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect width="20" height="12" x="2" y="6" rx="2" />
                <circle cx="12" cy="12" r="2" />
                <path d="M6 12h.01M18 12h.01" />
              </svg>
            </AtacadoIconButton>
          </div>
        )}
      </tr>
    );
  }

  const copyToClipboard = useCallback((text: string, cellId: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCell(cellId);
      setTimeout(() => setCopiedCell(null), 1800);
    });
  }, []);

  const formatPriceDisplay = (n: number): string => (n == null || Number.isNaN(n) ? "" : Number(n).toFixed(2).replace(".", ","));

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/mercadolivre/accounts");
    if (res.ok) {
      const data = await res.json();
      const accs: MLAccount[] = data.accounts ?? [];
      setAccounts(accs);
      if (accs.length > 0 && !accountId) {
        const fromUrl = searchParams.get("accountId");
        const fromStorage =
          typeof window !== "undefined"
            ? localStorage.getItem(DASHBOARD_ACCOUNT_STORAGE_KEY)
            : null;
        const owned = new Set(accs.map((a) => a.id));
        const candidate = fromUrl ?? fromStorage ?? accs[0].id;
        const next = owned.has(candidate) ? candidate : accs[0].id;
        setAccountId(next);
        if (typeof window !== "undefined" && next) {
          localStorage.setItem(DASHBOARD_ACCOUNT_STORAGE_KEY, next);
        }
      }
    }
    setAccountsLoaded(true);
  }, [accountId, searchParams]);

  const loadRows = useCallback(async (forceRefresh = false) => {
    if (!accountId) return;
    if (accounts.length > 0 && !accounts.some((a) => a.id === accountId)) {
      setRows([]);
      setTotal(0);
      setTotalItems(0);
      setRowsFetchError("Conta selecionada não está disponível. Escolha outra conta no menu superior.");
      setLoadingRows(false);
      return;
    }
    setLoadingRows(true);
    setRowsFetchError(null);
    const params = new URLSearchParams({
      accountId,
      page: String(apiListPage(pageSize, page)),
      limit: String(pageSize),
    });
    if (filtersApplied.mlb.trim()) params.set("mlb", filtersApplied.mlb.trim());
    if (filtersApplied.mlbu.trim()) params.set("mlbu_code", filtersApplied.mlbu.trim());
    if (filtersApplied.title.trim()) params.set("title", filtersApplied.title.trim());
    if (filtersApplied.sku.trim()) params.set("sku", filtersApplied.sku.trim());
    if (filtersApplied.filterExtra) params.set("filter", filtersApplied.filterExtra);
    if (filtersApplied.tagIds.length > 0) params.set("tags", filtersApplied.tagIds.join(","));
    if (forceRefresh) params.set("_", String(Date.now()));
    try {
      const res = await fetch(`/api/atacado/rows?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setTotalItems(data.totalItems ?? 0);
        setEdits({});
        setEditingMinQty({});
        setEditingPrice({});
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setRows([]);
        setTotal(0);
        setTotalItems(0);
        setRowsFetchError(data.error ?? `Erro ao carregar atacado (${res.status}).`);
      }
    } catch {
      setRows([]);
      setTotal(0);
      setTotalItems(0);
      setRowsFetchError("Erro de conexão ao carregar anúncios.");
    }
    setLoadingRows(false);
  }, [accountId, accounts, page, pageSize, filtersApplied]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Se não houver contas após carregar, não há rows para carregar
  useEffect(() => {
    if (accountsLoaded && accounts.length === 0) {
      setLoadingRows(false);
    }
  }, [accountsLoaded, accounts.length]);

  const urlFilter = searchParams.get("filter");
  useEffect(() => {
    const fromUrl = searchParams.get("accountId");
    if (fromUrl && fromUrl !== accountId) {
      if (accounts.length === 0 || accounts.some((a) => a.id === fromUrl)) {
        setAccountId(fromUrl);
        if (typeof window !== "undefined") {
          localStorage.setItem(DASHBOARD_ACCOUNT_STORAGE_KEY, fromUrl);
        }
      }
    }
  }, [searchParams, accounts, accountId]);
  useEffect(() => {
    if (
      urlFilter === "price_high" ||
      urlFilter === "mlbu" ||
      urlFilter === "com_familia" ||
      urlFilter === "com_rascunho" ||
      urlFilter === "sem_rascunho"
    ) {
      setDraftFilterExtra(urlFilter);
      setFiltersApplied((prev) => ({ ...prev, filterExtra: urlFilter }));
    }
  }, [urlFilter]);

  useEffect(() => {
    if (!bulkActionsMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (bulkActionsRef.current && !bulkActionsRef.current.contains(e.target as Node)) {
        setBulkActionsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [bulkActionsMenuOpen]);

  useEffect(() => {
    if (!optionsMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(e.target as Node)) {
        setOptionsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [optionsMenuOpen]);

  const handleFilterSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setFiltersApplied({
      mlb: draftMlb.trim(),
      mlbu: draftMlbu.trim(),
      title: draftTitle.trim(),
      sku: draftSku.trim(),
      filterExtra: draftFilterExtra,
      tagIds: draftFilterTagIds,
    });
    setPage(1);
    setFiltersModalOpen(false);
  }, [draftMlb, draftMlbu, draftTitle, draftSku, draftFilterExtra, draftFilterTagIds]);

  const toggleDraftFilterTag = useCallback((tagId: string) => {
    setDraftFilterTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }, []);

  const clearFilters = useCallback(() => {
    setDraftMlb("");
    setDraftMlbu("");
    setDraftTitle("");
    setDraftSku("");
    setDraftFilterExtra("");
    setFiltersApplied({
      mlb: "",
      mlbu: "",
      title: "",
      sku: "",
      filterExtra: "",
      tagIds: [],
    });
    setDraftFilterTagIds([]);
    setPage(1);
    setFiltersModalOpen(false);
  }, []);

  const showFilterResetButton = Boolean(
    draftMlb ||
    draftMlbu ||
    draftTitle ||
    draftSku ||
    draftFilterExtra ||
    draftFilterTagIds.length > 0 ||
    filtersApplied.tagIds.length > 0
  );

  useEffect(() => {
    if (accountId) loadRows();
  }, [accountId, loadRows]);


  const editedCount = Object.values(edits).filter((e) => e.status === "edited" || e.status === "error").length;

  const getEditState = (r: AtacadoRow): RowEditState => {
    const key = rowKey(r);
    return edits[key] ?? defaultRowEditState(r);
  };

  const parsePriceInput = (raw: string): number => {
    if (typeof raw !== "string") return raw || 0;
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    // Remove espaços e quaisquer caracteres que não sejam dígitos, vírgula, ponto ou sinal de menos
    const cleaned = trimmed.replace(/[^\d,.-]/g, "");
    // Se tiver vírgula e ponto, assumimos ponto como separador de milhar e vírgula como decimal
    if (cleaned.includes(",") && cleaned.includes(".")) {
      const noThousands = cleaned.replace(/\./g, "");
      return parseFloat(noThousands.replace(",", ".")) || 0;
    }
    // Apenas vírgula: tratamos como separador decimal
    if (cleaned.includes(",")) {
      return parseFloat(cleaned.replace(",", ".")) || 0;
    }
    // Caso geral: número simples com ponto ou só dígitos
    return parseFloat(cleaned) || 0;
  };

  const commitMinQtyBlur = (r: AtacadoRow, tierIdx: number, raw: string) => {
    const rk = rowKey(r);
    const draftKey = `${rk}-${tierIdx}`;
    setEditingMinQty((prev) => {
      const next = { ...prev };
      delete next[draftKey];
      return next;
    });

    const trimmed = raw.trim();
    const cur = getEditState(r);
    let slots = [...padSlots5(cur.slots)];

    if (trimmed === "") {
      slots[tierIdx] = null;
      if (!minQtyStrictlyOrderedInSlots(slots)) {
        setMessage({
          type: "error",
          text: "Não é possível deixar esta coluna vazia sem quebrar a ordem das quantidades (cada «Qt. Atac.» preenchida deve ser maior que a da esquerda).",
        });
        return;
      }
      setEdits((prev) => ({ ...prev, [rk]: { slots, status: "edited" } }));
      return;
    }

    const parsed = parseInt(trimmed, 10);
    if (Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed < 2) {
      setMessage({ type: "error", text: "Quantidade mínima deve ser um inteiro ≥ 2." });
      return;
    }

    if (slots[tierIdx] == null) {
      slots[tierIdx] = { min_qty: 2, price: 0 };
    }
    slots[tierIdx] = { ...slots[tierIdx]!, min_qty: parsed };

    if (!minQtyStrictlyOrderedInSlots(slots)) {
      setMessage({
        type: "error",
        text: "Cada «Qt. Atac.» tem de ser maior que todas à esquerda (ex.: se a coluna 2 é 5, a coluna 3 só aceita > 5).",
      });
      return;
    }

    setEdits((prev) => ({ ...prev, [rk]: { slots, status: "edited" } }));
  };

  const updateTierPrice = (r: AtacadoRow, tierIdx: number, value: string | number) => {
    const rk = rowKey(r);
    const cur = getEditState(r);
    const slots = [...padSlots5(cur.slots)];
    if (slots[tierIdx] == null) {
      slots[tierIdx] = { min_qty: 2, price: 0 };
    }
    const price = typeof value === "string" ? parsePriceInput(value) : value;
    slots[tierIdx] = { ...slots[tierIdx]!, price };
    setEdits((prev) => ({
      ...prev,
      [rk]: { slots, status: "edited" },
    }));
  };

  const applyBulkMinQtyToPage = useCallback((): boolean => {
    const minQty = parseInt(bulkMinQtyStr.trim(), 10);
    if (Number.isNaN(minQty) || minQty < 2) {
      setMessage({ type: "error", text: "Quantidade mínima deve ser um inteiro ≥ 2." });
      return false;
    }
    if (rows.length === 0) {
      setMessage({ type: "error", text: "Nenhuma linha nesta página." });
      return false;
    }
    const skipHolder = { current: 0 };
    setEdits((prev) => {
      let skipped = 0;
      const next = { ...prev };
      for (const r of rows) {
        const key = rowKey(r);
        const cur = next[key] ?? defaultRowEditState(r);
        const slots = [...padSlots5(cur.slots)];
        if (slots[bulkTierIdx] == null) {
          slots[bulkTierIdx] = { min_qty: minQty, price: 0 };
        } else {
          slots[bulkTierIdx] = { ...slots[bulkTierIdx]!, min_qty: minQty };
        }
        if (!minQtyStrictlyOrderedInSlots(slots)) {
          skipped++;
          continue;
        }
        next[key] = { slots, status: "edited" };
      }
      skipHolder.current = skipped;
      return next;
    });
    setEditingPrice((ep) => {
      const n = { ...ep };
      for (const r of rows) {
        delete n[`${rowKey(r)}-${bulkTierIdx}`];
      }
      return n;
    });
    setEditingMinQty((ep) => {
      const n = { ...ep };
      for (const r of rows) {
        delete n[`${rowKey(r)}-${bulkTierIdx}`];
      }
      return n;
    });
    setMessage({
      type: "success",
      text:
        `Quantidade mínima ${minQty} aplicada em Qt. Atac. ${bulkTierIdx + 1} em ${rows.length - skipHolder.current} linha(s).` +
        (skipHolder.current > 0
          ? ` ${skipHolder.current} linha(s) ignoradas: a quantidade não pode ser ≤ faixas à esquerda ou ≥ faixas à direita.`
          : "") +
        " Faixas novas podem ficar sem preço válido até você preencher ou aplicar o desconto em massa no preço.",
    });
    return true;
  }, [rows, bulkMinQtyStr, bulkTierIdx]);

  const addBulkDiscountConditional = useCallback(() => {
    setBulkDiscountConditionals((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        op: "gte",
        compareField: "promotion",
        thresholdStr: "",
        discountStr: "",
        discountBase: "promotion",
      },
    ]);
  }, []);

  const removeBulkDiscountConditional = useCallback((id: string) => {
    setBulkDiscountConditionals((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const updateBulkDiscountConditional = useCallback((id: string, patch: Partial<BulkDiscountConditional>) => {
    setBulkDiscountConditionals((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const applyBulkDiscountToPage = useCallback((): boolean => {
    const defaultPct = parseBulkPercentInput(bulkDiscountStr);
    if (defaultPct == null) {
      setMessage({ type: "error", text: "Informe um desconto padrão entre 0 e 100%." });
      return false;
    }
    if (rows.length === 0) {
      setMessage({ type: "error", text: "Nenhuma linha nesta página." });
      return false;
    }

    const matchCount = new Map<string, number>();
    matchCount.set("default", 0);
    for (const c of bulkDiscountConditionals) matchCount.set(c.id, 0);

    let skipped = 0;
    setEdits((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        let pct = defaultPct;
        let baseChoice: "current" | "promotion" = bulkPriceBase;
        let matchedId = "default";

        for (const rule of bulkDiscountConditionals) {
          const th = parseBulkThresholdInput(rule.thresholdStr);
          const p = parseBulkPercentInput(rule.discountStr);
          if (th == null || p == null) continue;
          const compareVal = bulkCompareFieldValue(r, rule.compareField);
          if (compareVal == null) continue;
          if (!bulkConditionalPasses(compareVal, th, rule.op)) continue;
          pct = p;
          baseChoice = rule.discountBase;
          matchedId = rule.id;
          break;
        }

        const base = bulkBasePrice(r, baseChoice);
        if (base == null) {
          skipped++;
          continue;
        }
        matchCount.set(matchedId, (matchCount.get(matchedId) ?? 0) + 1);
        const factor = 1 - pct / 100;
        const newPrice = Math.round(base * factor * 100) / 100;
        const key = rowKey(r);
        const cur = next[key] ?? defaultRowEditState(r);
        const slots = [...padSlots5(cur.slots)];
        if (slots[bulkTierIdx] == null) {
          slots[bulkTierIdx] = { min_qty: 2, price: newPrice };
        } else {
          slots[bulkTierIdx] = { ...slots[bulkTierIdx]!, price: newPrice };
        }
        next[key] = { slots, status: "edited" };
      }
      return next;
    });
    setEditingPrice((ep) => {
      const n = { ...ep };
      for (const r of rows) {
        delete n[`${rowKey(r)}-${bulkTierIdx}`];
      }
      return n;
    });

    const applied = rows.length - skipped;
    if (applied === 0) {
      setMessage({
        type: "error",
        text:
          "Nenhuma linha foi atualizada: falta preço atual ou promoção onde a regra aplicável exige (incluindo a base do desconto após critérios condicionais).",
      });
      return false;
    }
    const parts: string[] = [];
    const defN = matchCount.get("default") ?? 0;
    if (bulkDiscountConditionals.length === 0) {
      const baseLabel = bulkPriceBase === "current" ? "preço atual (ML)" : "promoção (calculadora)";
      setMessage({
        type: "success",
        text:
          `Atacado ${bulkTierIdx + 1}: ${defaultPct}% sobre ${baseLabel} em ${applied} linha(s).` +
          (skipped > 0 ? ` ${skipped} ignorada(s) sem preço base.` : ""),
      });
      return true;
    }
    if (defN > 0) parts.push(`${defN} pela regra padrão (${defaultPct}%)`);
    bulkDiscountConditionals.forEach((c, idx) => {
      const n = matchCount.get(c.id) ?? 0;
      if (n > 0) {
        const p = parseBulkPercentInput(c.discountStr);
        parts.push(`${n} pelo critério #${idx + 1}${p != null ? ` (${p}%)` : ""}`);
      }
    });
    setMessage({
      type: "success",
      text:
        `Atacado ${bulkTierIdx + 1}: desconto aplicado em ${applied} linha(s). ` +
        parts.join("; ") +
        "." +
        (skipped > 0 ? ` ${skipped} ignorada(s) sem preço base para a regra que valeria na linha.` : ""),
    });
    return true;
  }, [rows, bulkDiscountStr, bulkPriceBase, bulkTierIdx, bulkDiscountConditionals]);

  const clearAllAtacadoOnPage = useCallback(() => {
    if (rows.length === 0) {
      setMessage({ type: "error", text: "Nenhuma linha nesta página." });
      return;
    }
    if (
      !window.confirm(
        `Limpar todas as faixas de atacado (Atacado 1–5) nas ${rows.length} linha(s) desta página?\n\n` +
          "Ao salvar, os rascunhos serão removidos para esses itens. Esta ação não altera o Mercado Livre até você usar «Aplicar Preços»."
      )
    ) {
      return;
    }
    setEdits((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        next[rowKey(r)] = { slots: Array(ATACADO_SLOT_COUNT).fill(null) as (Tier | null)[], status: "edited" };
      }
      return next;
    });
    setEditingPrice((ep) => {
      const n = { ...ep };
      for (const r of rows) {
        const k = rowKey(r);
        for (let i = 0; i < 5; i++) {
          delete n[`${k}-${i}`];
        }
      }
      return n;
    });
    setEditingMinQty((ep) => {
      const n = { ...ep };
      for (const r of rows) {
        const k = rowKey(r);
        for (let i = 0; i < 5; i++) {
          delete n[`${k}-${i}`];
        }
      }
      return n;
    });
    setMessage({
      type: "success",
      text: `Faixas de atacado limpas em ${rows.length} linha(s). Clique em «Salvar alterações» para remover os rascunhos no banco.`,
    });
  }, [rows]);

  const revertRow = (r: AtacadoRow) => {
    const key = rowKey(r);
    setEditingMinQty((prev) => {
      const next = { ...prev };
      for (let i = 0; i < ATACADO_SLOT_COUNT; i++) {
        delete next[`${key}-${i}`];
      }
      return next;
    });
    setEditingPrice((prev) => {
      const next = { ...prev };
      for (let i = 0; i < ATACADO_SLOT_COUNT; i++) {
        delete next[`${key}-${i}`];
      }
      return next;
    });
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validateRow = (r: AtacadoRow): string | null => {
    const slots = padSlots5(getEditState(r).slots);
    let hasAny = false;
    for (let i = 0; i < ATACADO_SLOT_COUNT; i++) {
      const t = slots[i];
      if (t == null) continue;
      hasAny = true;
      if (t.min_qty < 2 || !Number.isInteger(t.min_qty)) {
        return `Qt. Atac. ${i + 1}: quantidade mínima deve ser inteiro ≥ 2`;
      }
      if (t.price <= 0) {
        return `R$ Atac. ${i + 1}: preço deve ser > 0`;
      }
    }
    if (!hasAny) return null;
    if (!minQtyStrictlyOrderedInSlots(slots)) {
      return "Faixas: cada «Qt. Atac.» tem de ser maior que todas à esquerda (sem repetir nem diminuir).";
    }
    return null;
  };

  const saveRow = async (r: AtacadoRow) => {
    const cur = getEditState(r);
    const normalized = normalizeTiers(nonNullTiersInSlotOrder(cur.slots));
    const tierErrs = validateTiers(normalized);
    if (tierErrs.length > 0) {
      const key = rowKey(r);
      setEdits((prev) => ({ ...prev, [key]: { ...cur, status: "error", error: tierErrs.join(" ") } }));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/atacado/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          rows: [{ item_id: r.item_id, variation_id: r.variation_id, tiers: normalized }],
        }),
      });
      let data: { ok?: boolean; saved_count?: number; errors?: { message?: string }[]; error?: string } = {};
      try {
        data = await res.json();
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        setMessage({
          type: "error",
          text: data.error ?? data.errors?.[0]?.message ?? `Erro ao salvar (${res.status}).`,
        });
        return;
      }
      if (data.ok === false && (data.saved_count ?? 0) === 0) {
        setMessage({ type: "error", text: data.errors?.[0]?.message ?? "Erro ao salvar." });
        return;
      }
      setMessage({ type: "success", text: "Linha salva." });
      await loadRows();
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
    } finally {
      setSaving(false);
    }
  };

  /** Salva alterações pendentes nos drafts. Retorna true se salvou (ou não havia nada) e false se deu erro. */
  const savePendingEdits = async (): Promise<boolean> => {
    const toSave = rows.filter((r) => {
      const s = getEditState(r).status;
      return s === "edited" || s === "error";
    });
    const pendingElsewhere = Object.entries(edits).some(
      ([key, e]) =>
        (e.status === "edited" || e.status === "error") && !rows.some((r) => rowKey(r) === key)
    );
    if (toSave.length === 0) {
      if (pendingElsewhere) {
        setMessage({
          type: "error",
          text: "Há alterações em outra página. Volte à página onde editou para salvar, ou percorra todas as páginas com itens alterados.",
        });
        return false;
      }
      return true;
    }

    const valid: { r: AtacadoRow; tiers: Tier[] }[] = [];
    const invalid: { r: AtacadoRow; err: string }[] = [];
    for (const r of toSave) {
      const normalized = normalizeTiers(nonNullTiersInSlotOrder(getEditState(r).slots));
      const tierErrs = validateTiers(normalized);
      if (tierErrs.length > 0) {
        invalid.push({ r, err: tierErrs.join(" ") });
      } else {
        valid.push({ r, tiers: normalized });
      }
    }
    if (invalid.length > 0) {
      for (const { r, err } of invalid) {
        const key = rowKey(r);
        setEdits((prev) => ({ ...prev, [key]: { ...getEditState(r), status: "error", error: err } }));
      }
      setMessage({
        type: "error",
        text:
          invalid.length === toSave.length
            ? `${invalid.length} linha(s) com erro de validação. Corrija preços/quantidades e tente novamente.`
            : `${invalid.length} linha(s) com erro (não salvas). ${valid.length} linha(s) válida(s) serão gravadas.`,
      });
    }
    if (valid.length === 0) {
      return false;
    }
    try {
      const payload = {
        accountId,
        rows: valid.map(({ r, tiers }) => ({
          item_id: r.item_id,
          variation_id: r.variation_id,
          tiers,
        })),
      };
      const res = await fetch("/api/atacado/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let data: { ok?: boolean; saved_count?: number; errors?: { message?: string }[]; error?: string } = {};
      try {
        data = await res.json();
      } catch {
        /* ignore */
      }
      if (!res.ok) {
        setMessage({
          type: "error",
          text: data.error ?? data.errors?.[0]?.message ?? `Erro ao salvar (${res.status}).`,
        });
        return false;
      }
      if (data.ok === false && (data.saved_count ?? 0) === 0) {
        setMessage({ type: "error", text: data.errors?.[0]?.message ?? "Erro ao salvar." });
        return false;
      }
      const saved = data.saved_count ?? 0;
      if (invalid.length > 0) {
        setMessage({
          type: "success",
          text: `${saved} linha(s) salva(s). ${invalid.length} linha(s) ainda com erro — corrija e salve de novo.`,
        });
      } else {
        setMessage({ type: "success", text: `${saved} linha(s) salva(s).` });
      }
      await loadRows();
      return true;
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
      return false;
    }
  };

  const saveAll = async () => {
    if (editedCount === 0) {
      setMessage({ type: "success", text: "Nenhuma alteração pendente." });
      return;
    }
    setSaving(true);
    try {
      await savePendingEdits();
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const params = new URLSearchParams({ accountId });
    if (filtersApplied.mlb.trim()) params.set("mlb", filtersApplied.mlb.trim());
    if (filtersApplied.mlbu.trim()) params.set("mlbu_code", filtersApplied.mlbu.trim());
    if (filtersApplied.title.trim()) params.set("title", filtersApplied.title.trim());
    if (filtersApplied.sku.trim()) params.set("sku", filtersApplied.sku.trim());
    if (filtersApplied.filterExtra) params.set("filter", filtersApplied.filterExtra);
    if (filtersApplied.tagIds.length > 0) params.set("tags", filtersApplied.tagIds.join(","));
    window.open(`/api/atacado/export?${params}`, "_blank");
    setMessage({ type: "success", text: "Exportação iniciada." });
  };

  const openImportCsv = () => {
    setImportResult(null);
    setImportFile(null);
    setImportCsvModalOpen(true);
  };

  const importFromMl = async () => {
    if (!accountId || seedFromMlLoading) return;
    const confirmed = window.confirm(
      "Importar do Mercado Livre?\n\n" +
        "Os rascunhos desta tela serão substituídos pelas faixas de atacado que estão hoje no Mercado Livre, inclusive linhas que você já editou."
    );
    if (!confirmed) return;
    setSeedFromMlLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/atacado/seed-from-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, mode: "overwrite" }),
      });
      let data: {
        error?: string;
        message?: string;
        seeded_count?: number;
        skipped_has_draft?: number;
        skipped_no_ml_data?: number;
        skipped_invalid?: number;
      } = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Erro ao importar do Mercado Livre." });
        return;
      }
      if (data.message) {
        setMessage({ type: "success", text: data.message });
      } else {
        const bits: string[] = [`${data.seeded_count ?? 0} linha(s) de rascunho criada(s) ou atualizada(s).`];
        if ((data.skipped_has_draft ?? 0) > 0) bits.push(`${data.skipped_has_draft} ignorada(s) (já tinham rascunho).`);
        if ((data.skipped_no_ml_data ?? 0) > 0)
          bits.push(`${data.skipped_no_ml_data} item(s) sem atacado no Mercado Livre.`);
        if ((data.skipped_invalid ?? 0) > 0) bits.push(`${data.skipped_invalid} ignorada(s) na validação.`);
        setMessage({ type: "success", text: bits.join(" ") });
      }
      await loadRows(true);
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
    } finally {
      setSeedFromMlLoading(false);
    }
  };

  const onImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImportCsvModalOpen(false);
    setImportLoading(true);
    setImportResult(null);
    setImportFile(file);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/atacado/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Erro ao processar CSV." });
        setImportFile(null);
        return;
      }
      setImportResult(data);
      if (data.ok === false && (data.errors?.length || data.headerError)) {
        setMessage({ type: "error", text: data.errors?.[0]?.message ?? data.headerError ?? "Erro no CSV." });
      }
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
      setImportFile(null);
    } finally {
      setImportLoading(false);
    }
  };

  const confirmImport = async () => {
    if (!accountId || !importResult) {
      setMessage({ type: "error", text: "Conta ou resultado da importação não encontrado. Refaça a importação do CSV." });
      return;
    }
    const items = importResult.valid_items;
    const hasItems = Array.isArray(items) && items.length > 0;
    if (!hasItems && !importFile) {
      setMessage({ type: "error", text: "Nada a confirmar (sem itens no preview). Refaça a importação do CSV." });
      return;
    }
    if (!hasItems && importFile) {
      console.log("[Confirmar Importação] Preview sem valid_items; usando arquivo (refaça a importação para usar o novo fluxo).");
    }
    setImportConfirming(true);
    setMessage(null);
    try {
      let res: Response;
      if (hasItems) {
        const body = { accountId, items };
        console.log("[Confirmar Importação] Enviando", items.length, "itens");
        res = await fetch("/api/atacado/import/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        console.log("[Confirmar Importação] Enviando arquivo CSV");
        const form = new FormData();
        form.append("file", importFile!);
        form.append("accountId", accountId);
        res = await fetch("/api/atacado/import/confirm", { method: "POST", body: form });
      }
      const text = await res.text();
      let data: { ok?: boolean; saved_count?: number; error?: string; warning?: string; details?: string[] };
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        console.error("[Confirmar Importação] Resposta não é JSON:", res.status, text.slice(0, 200));
        setMessage({ type: "error", text: `Erro do servidor (${res.status}). Veja o console (F12).` });
        return;
      }
      console.log("[Confirmar Importação] Resposta:", res.status, data);
      if (data.ok) {
        const msg = data.warning
          ? `${data.saved_count ?? 0} linha(s) importada(s). ${data.warning}`
          : `${data.saved_count ?? 0} linha(s) importada(s).`;
        setMessage({ type: "success", text: msg });
        if (data.details?.length) console.warn("[Confirmar Importação] Detalhes:", data.details);
        setImportResult(null);
        setImportFile(null);
        await loadRows(true);
      } else {
        const detail = data.details?.length ? ` — ${data.details[0]}` : "";
        setMessage({ type: "error", text: (data.error ?? "Erro ao confirmar importação.") + detail });
      }
    } catch (e) {
      console.error("[Confirmar Importação] Erro:", e);
      setMessage({ type: "error", text: "Erro de conexão. Veja o console (F12)." });
    } finally {
      setImportConfirming(false);
    }
  };

  const cancelImport = () => {
    setImportResult(null);
    setImportFile(null);
    setImportCsvModalOpen(false);
  };

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  const fetchApplyJob = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) return;
    const data = await res.json();
    setApplyJob({ job: data.job, logs: data.logs ?? [] });
  }, []);

  const startApply = async () => {
    if (!accountId) return;
    setApplyLoading(true);
    setMessage(null);
    try {
      if (editedCount > 0) {
        setMessage({ type: "success", text: "Salvando alterações antes de aplicar…" });
        const saved = await savePendingEdits();
        if (!saved) {
          setApplyLoading(false);
          return;
        }
      }
      const res = await fetch("/api/atacado/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? "Erro ao iniciar aplicação." });
        return;
      }
      setApplyJobId(data.job_id);
      await fetchApplyJob(data.job_id);
    } catch {
      setMessage({ type: "error", text: "Erro de conexão." });
    } finally {
      setApplyLoading(false);
    }
  };

  useEffect(() => {
    if (!applyJobId) return;
    const status = applyJob?.job?.status;
    if (status === "queued" || status === "running") {
      const interval = setInterval(() => fetchApplyJob(applyJobId), 2500);
      return () => clearInterval(interval);
    }
  }, [applyJobId, applyJob?.job?.status, fetchApplyJob]);

  const totalPages = computeTotalPages(total, pageSize);

  if (accountsLoaded && accounts.length === 0) {
    return (
      <div className="rounded-app bg-amber-50 p-4 shadow-sm ring-1 ring-amber-200">
        <p className="text-amber-800">
          Conecte sua conta do Mercado Livre em{" "}
          <a href="/app/configuracao" className="font-medium underline">
            Configuração
          </a>{" "}
          para usar o editor de atacado.
        </p>
      </div>
    );
  }

  if ((loadingRows || !accountsLoaded) && rows.length === 0) {
    return (
      <div className="adminty-atacado-page space-y-5">
        <div className="table-page-shell p-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando…</p>
        </div>
      </div>
    );
  }

  const atacadoRefetching = loadingRows && rows.length > 0;
  const atacadoLoaderMessages = [
    "Carregando anúncios…",
    "Buscando anúncios no banco…",
    "Mesclando rascunhos de atacado…",
    "Montando a grade de preços…",
  ] as const;
  const applyLoaderMessages = [
    "Enviando preços de atacado ao Mercado Livre…",
    "Cada anúncio é atualizado na API do ML…",
    "Aguarde — volumes grandes podem levar alguns minutos…",
  ] as const;

  const smartLoaderOpen = atacadoRefetching || applyJob != null;
  const applyDeterminatePercent = (() => {
    if (loadingRows || !applyJob) return undefined;
    const { total, processed, status } = applyJob.job;
    if (total > 0) return Math.min(100, (processed / total) * 100);
    if (status === "queued" || status === "running") return undefined;
    return 100;
  })();

  return (
    <div className="adminty-atacado-page space-y-5">
      <div className="table-page-shell">
        <SmartLoaderOverlay
        open={smartLoaderOpen}
        messages={atacadoRefetching ? [...atacadoLoaderMessages] : applyJob != null ? [...applyLoaderMessages] : [...atacadoLoaderMessages]}
        determinatePercent={applyDeterminatePercent}
        footerHint={
          !loadingRows && applyJob
            ? `Status: ${applyJob.job.status} · Progresso: ${applyJob.job.processed}/${applyJob.job.total} · OK: ${applyJob.job.ok} · Erros: ${applyJob.job.errors}`
            : undefined
        }
        panelClassName={applyJob != null && !loadingRows ? "max-w-lg max-h-[min(90vh,40rem)] overflow-y-auto" : undefined}
      >
        {!loadingRows && applyJob && (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const id = applyJobId ?? applyJob.job.id;
                  if (id) void fetchApplyJob(id);
                }}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/50"
              >
                Atualizar
              </button>
              <button
                type="button"
                onClick={() => {
                  setApplyJob(null);
                  setApplyJobId(null);
                }}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/50"
              >
                Fechar
              </button>
            </div>
            {applyJob.logs.filter((l) => l.status === "error").length > 0 && (
              <div className="max-h-48 overflow-auto rounded-lg border border-red-200 bg-red-50 p-3 text-left text-sm dark:border-red-900/50 dark:bg-red-950/40">
                <p className="mb-2 font-medium text-red-800 dark:text-red-200">Erros</p>
                <ul className="space-y-1">
                  {applyJob.logs
                    .filter((l) => l.status === "error")
                    .slice(0, 20)
                    .map((log, idx) => (
                      <li key={idx} className="text-red-700 dark:text-red-300">
                        {log.item_id ?? ""}
                        {log.variation_id != null ? ` (var ${log.variation_id})` : ""}: {log.message ?? "—"}
                      </li>
                    ))}
                  {applyJob.logs.filter((l) => l.status === "error").length > 20 && (
                    <li className="text-red-600 dark:text-red-400">… e mais erros (veja logs no servidor)</li>
                  )}
                </ul>
              </div>
            )}
          </>
        )}
      </SmartLoaderOverlay>

        <div className="table-page-toolbar">
          <div className="flex flex-wrap items-end gap-1">
            <button
              type="button"
              onClick={() => setAtacadoTab("lista")}
              className={
                atacadoTab === "lista"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Atacado
            </button>
            <button
              type="button"
              onClick={() => setAtacadoTab("como-funciona")}
              className={
                atacadoTab === "como-funciona"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Como funciona?
            </button>
          </div>
        </div>

        {atacadoTab === "como-funciona" && (
          <div className="table-page-filters">
            <AtacadoHelpContent />
          </div>
        )}

        {atacadoTab === "lista" && (
        <>
        <div className="border-b border-slate-100 px-3 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveAll}
              disabled={saving || editedCount === 0}
              className="btn btn-primary btn-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar alterações"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={onImportFileChange}
            />
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={openImportCsv}
                disabled={importLoading || seedFromMlLoading}
                className="btn btn-secondary btn-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importLoading ? "Processando…" : "Importar CSV"}
              </button>
              <button
                type="button"
                onClick={exportCsv}
                disabled={importLoading || seedFromMlLoading || !accountId}
                className="btn btn-secondary btn-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Exportar CSV
              </button>
            </div>
            <button
              type="button"
              onClick={() => importFromMl()}
              disabled={importLoading || seedFromMlLoading || !accountId}
              className="btn btn-sm border-2 border-yellow-400 bg-white text-amber-950 shadow-sm hover:bg-yellow-50 focus:ring-yellow-400/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-yellow-500 dark:bg-slate-900 dark:text-yellow-100 dark:hover:bg-yellow-950/40"
              title="Substitui os rascunhos pelas faixas de atacado atuais no Mercado Livre."
            >
              {seedFromMlLoading ? "Importando…" : "Importar do ML"}
            </button>
            <button
              type="button"
              onClick={startApply}
              disabled={applyLoading || saving || !accountId}
              className="btn btn-success btn-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {applyLoading ? (editedCount > 0 ? "Salvando e aplicando…" : "Aplicando…") : "Aplicar no Mercado Livre"}
            </button>
            <div className="btn-dropdown relative" ref={bulkActionsRef}>
              <button
                type="button"
                onClick={() => setBulkActionsMenuOpen((o) => !o)}
                disabled={loadingRows || rows.length === 0}
                className="btn btn-secondary btn-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Ações em massa
                <svg className="h-3.5 w-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {bulkActionsMenuOpen && (
                <div className="btn-dropdown-menu left-0 min-w-[14rem]" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="btn-dropdown-item"
                    onClick={() => {
                      setBulkActionsMenuOpen(false);
                      setBulkMinQtyModalOpen(true);
                    }}
                  >
                    Editar quantidade mínima…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="btn-dropdown-item"
                    onClick={() => {
                      setBulkActionsMenuOpen(false);
                      setBulkDiscountModalOpen(true);
                    }}
                  >
                    Preço com desconto %…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="btn-dropdown-item text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    onClick={() => {
                      setBulkActionsMenuOpen(false);
                      clearAllAtacadoOnPage();
                    }}
                  >
                    Limpar todas as colunas de atacado…
                  </button>
                </div>
              )}
            </div>
            {editedCount > 0 && (
              <span className="text-xs font-medium text-amber-700">{editedCount} linha(s) alterada(s)</span>
            )}
          </div>
        </div>

        <div className="pricing-filter-bar">
          <div className="pricing-filter-bar-meta flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[12px]">
            <span className="pricing-filter-bar-label">Filtros:</span>
            {appliedAtacadoFilterLabels.length > 0 ? (
              appliedAtacadoFilterLabels.map((label, idx) => (
                <span
                  key={`${idx}-${label}`}
                  className="table-mini-control"
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="text-slate-500 dark:text-slate-400">Nenhum filtro aplicado</span>
            )}
            {appliedAtacadoFilterLabels.length > 0 && (
              <button
                type="button"
                onClick={() => clearFilters()}
                className="text-[11px] font-semibold text-[#0d6efd] hover:underline"
              >
                Limpar
              </button>
            )}
          </div>
          <div className="btn-dropdown relative flex items-center gap-1" ref={optionsMenuRef}>
            <button
              type="button"
              onClick={() => {
                setDraftMlb(filtersApplied.mlb);
                setDraftMlbu(filtersApplied.mlbu);
                setDraftTitle(filtersApplied.title);
                setDraftSku(filtersApplied.sku);
                setDraftFilterExtra(filtersApplied.filterExtra);
                setDraftFilterTagIds(filtersApplied.tagIds);
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
              <div className="btn-dropdown-menu right-0 top-9 z-20 w-48">
                <button
                  type="button"
                  onClick={() => {
                    exportCsv();
                    setOptionsMenuOpen(false);
                  }}
                  className="btn-dropdown-item"
                >
                  Exportar CSV
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void loadRows();
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

        {message && (
          <div
            className={`mx-3 mt-3 rounded p-3 ${
              message.type === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
            }`}
          >
            {message.text}
          </div>
        )}

      {bulkMinQtyModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Fechar"
            onClick={() => setBulkMinQtyModalOpen(false)}
          />
          <div
            className="modal-panel relative w-full max-w-md p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-minqty-title"
          >
            <h2 id="bulk-minqty-title" className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
              Quantidade mínima em massa
            </h2>
            <p className="mb-4 text-xs text-slate-600 dark:text-slate-300">
              Aplica só nas <strong>{rows.length}</strong> linha{rows.length !== 1 ? "s" : ""} desta página (filtros atuais). Faixas novas podem ficar sem preço até você preencher ou usar desconto em massa.
            </p>
            <div className="mb-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-200">Coluna</label>
                <select
                  value={bulkTierIdx}
                  onChange={(e) => setBulkTierIdx(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n - 1}>
                      Atacado {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-200">Quantidade mínima</label>
                <input
                  type="text"
                  autoComplete="off"
                  value={bulkMinQtyStr}
                  onChange={(e) => setBulkMinQtyStr(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkMinQtyModalOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (applyBulkMinQtyToPage()) setBulkMinQtyModalOpen(false);
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                Aplicar na página
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkDiscountModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Fechar"
            onClick={() => setBulkDiscountModalOpen(false)}
          />
          <div
            className="modal-panel relative max-h-[min(90vh,40rem)] w-full max-w-5xl overflow-y-auto p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-discount-title"
          >
            <h2 id="bulk-discount-title" className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
              Preço com desconto %
            </h2>
            <p className="mb-3 text-xs text-slate-600 dark:text-slate-300">
              {rows.length} linha{rows.length !== 1 ? "s" : ""} nesta página. Regra padrão quando nenhum critério condicional se aplica; critérios são avaliados em ordem.
            </p>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-200">Coluna de atacado</label>
              <select
                value={bulkTierIdx}
                onChange={(e) => setBulkTierIdx(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n - 1}>
                    Atacado {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-600 dark:bg-slate-900/40">
              <span className="mb-2 block text-xs font-medium text-slate-800 dark:text-slate-100">Regra padrão</span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 5"
                  value={bulkDiscountStr}
                  onChange={(e) => setBulkDiscountStr(e.target.value)}
                  className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                />
                <span className="text-xs text-slate-700 dark:text-slate-200">% sobre</span>
                <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-800 dark:text-slate-100">
                  <input
                    type="radio"
                    name="bulkPriceBaseModal"
                    checked={bulkPriceBase === "current"}
                    onChange={() => setBulkPriceBase("current")}
                    className="text-indigo-600"
                  />
                  Preço atual (ML)
                </label>
                <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-800 dark:text-slate-100">
                  <input
                    type="radio"
                    name="bulkPriceBaseModal"
                    checked={bulkPriceBase === "promotion"}
                    onChange={() => setBulkPriceBase("promotion")}
                    className="text-indigo-600"
                  />
                  Promoção
                </label>
              </div>
            </div>
            <div className="mb-4 rounded-lg border border-indigo-200/80 bg-indigo-50/40 p-3 dark:border-indigo-800 dark:bg-slate-900/30">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-200">
                  Critérios condicionais (opcional)
                </span>
                <button
                  type="button"
                  onClick={addBulkDiscountConditional}
                  className="rounded-md border border-indigo-300 bg-white px-2 py-1 text-[10px] font-medium text-indigo-800 hover:bg-indigo-50 dark:border-indigo-600 dark:bg-slate-800 dark:text-indigo-200 dark:hover:bg-slate-800/80"
                >
                  + Adicionar critério
                </button>
              </div>
              {bulkDiscountConditionals.length === 0 ? (
                <p className="text-[10px] text-indigo-800/80 dark:text-indigo-300/80">Nenhum critério extra.</p>
              ) : (
                <ul className="space-y-2">
                  {bulkDiscountConditionals.map((rule, idx) => (
                    <li
                      key={rule.id}
                      className="flex flex-nowrap items-center gap-x-2 gap-y-1 overflow-x-auto rounded-md border border-indigo-100 bg-white/80 px-2 py-2 dark:border-indigo-900 dark:bg-slate-900/50"
                    >
                      <span className="w-6 shrink-0 text-center text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                        {idx + 1}
                      </span>
                      <span className="text-[10px] text-indigo-800 dark:text-indigo-200">Se</span>
                      <select
                        value={rule.compareField}
                        onChange={(e) =>
                          updateBulkDiscountConditional(rule.id, {
                            compareField: e.target.value as "promotion" | "current",
                          })
                        }
                        className="max-w-[9rem] rounded border border-indigo-200 bg-white px-1.5 py-1 text-[10px] dark:border-indigo-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="promotion">promoção (calculadora)</option>
                        <option value="current">preço atual (ML)</option>
                      </select>
                      <select
                        value={rule.op}
                        onChange={(e) =>
                          updateBulkDiscountConditional(rule.id, { op: e.target.value as BulkDiscountCompareOp })
                        }
                        className="shrink-0 rounded border border-indigo-200 bg-white px-1.5 py-1 text-[10px] dark:border-indigo-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        <option value="gt">maior que (&gt;)</option>
                        <option value="gte">maior ou igual (≥)</option>
                        <option value="lt">menor que (&lt;)</option>
                        <option value="lte">menor ou igual (≤)</option>
                        <option value="eq">igual a (=)</option>
                      </select>
                      <span className="text-[10px] text-indigo-800 dark:text-indigo-200">R$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="200"
                        value={rule.thresholdStr}
                        onChange={(e) => updateBulkDiscountConditional(rule.id, { thresholdStr: e.target.value })}
                        className="w-16 rounded border border-indigo-200 bg-white px-1.5 py-1 text-[10px] dark:border-indigo-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <span className="text-[10px] text-indigo-800 dark:text-indigo-200">→</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="%"
                        value={rule.discountStr}
                        onChange={(e) => updateBulkDiscountConditional(rule.id, { discountStr: e.target.value })}
                        className="w-12 rounded border border-indigo-200 bg-white px-1.5 py-1 text-[10px] dark:border-indigo-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <span className="text-[10px] text-indigo-800 dark:text-indigo-200">% sobre</span>
                      <label className="flex cursor-pointer items-center gap-0.5 text-[10px] text-indigo-900 dark:text-indigo-100">
                        <input
                          type="radio"
                          name={`bulkCondBase-${rule.id}`}
                          checked={rule.discountBase === "current"}
                          onChange={() => updateBulkDiscountConditional(rule.id, { discountBase: "current" })}
                          className="text-indigo-600"
                        />
                        atual
                      </label>
                      <label className="flex cursor-pointer items-center gap-0.5 text-[10px] text-indigo-900 dark:text-indigo-100">
                        <input
                          type="radio"
                          name={`bulkCondBase-${rule.id}`}
                          checked={rule.discountBase === "promotion"}
                          onChange={() => updateBulkDiscountConditional(rule.id, { discountBase: "promotion" })}
                          className="text-indigo-600"
                        />
                        promoção
                      </label>
                      <button
                        type="button"
                        onClick={() => removeBulkDiscountConditional(rule.id)}
                        className="ml-auto rounded px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      >
                        Remover
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-600">
              <button
                type="button"
                onClick={() => setBulkDiscountModalOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  if (applyBulkDiscountToPage()) setBulkDiscountModalOpen(false);
                }}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                Aplicar desconto na página
              </button>
            </div>
          </div>
        </div>
      )}

      {importCsvModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setImportCsvModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Importar CSV de atacado"
        >
          <div
            className="modal-panel-scroll max-h-[min(90vh,36rem)] w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-600">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Importar CSV de atacado</h2>
              <button
                type="button"
                onClick={() => setImportCsvModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4 p-4 text-sm text-slate-700 dark:text-slate-300">
              <p>
                O arquivo deve estar em <strong>UTF-8</strong>, com separador <strong>;</strong> (ponto e vírgula — não
                use vírgula como separador de colunas). A primeira linha precisa ser <strong>exatamente</strong> o
                cabeçalho abaixo (o mesmo do <strong>Exportar CSV</strong> desta tela).
              </p>
              <p>
                Colunas <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">preco_atual</code> e{" "}
                <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">promocao</code> são só de
                referência na planilha; na importação só as faixas{" "}
                <code className="rounded bg-slate-100 px-1 text-xs dark:bg-slate-800">atacado1…5</code> atualizam o
                rascunho.
              </p>
              <div>
                <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Cabeçalho obrigatório (1ª linha)</p>
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-snug text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200">
                  {CSV_HEADER_EXACT}
                </pre>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-600">
                <button
                  type="button"
                  onClick={() => setImportCsvModalOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importLoading || seedFromMlLoading}
                  className="rounded-lg bg-brand-blue px-4 py-2 text-xs font-semibold text-white hover:bg-brand-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Selecionar arquivo…
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importResult && (
        <div className="mb-6 rounded-lg border-2 border-gray-300 bg-gray-50 p-4">
          <h2 className="mb-3 text-lg font-semibold">Preview da importação</h2>
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <span className="font-medium">Total de linhas: {importResult.total_rows}</span>
            <span className="text-green-700">Válidas: {importResult.valid_rows}</span>
            <span className="text-red-700">Com erro: {importResult.error_rows}</span>
          </div>
          {importResult.preview.length > 0 && (
            <div className="mb-4">
              <AppTable summary={`Preview: ${importResult.valid_rows} válidas, ${importResult.error_rows} com erro`} maxHeight="20rem">
                <thead>
                  <tr>
                    <th className="p-2 font-medium">Linha</th>
                    <th className="p-2 font-medium">item_id</th>
                    <th className="p-2 font-medium">variation_id</th>
                    <th className="p-2 font-medium">sku</th>
                    <th className="max-w-[120px] truncate p-2 font-medium">Título</th>
                    <th className="p-2 font-medium">Preço atual R$</th>
                    <th className="p-2 font-medium">Promoção R$</th>
                    <th className="p-2 font-medium">Atacado 1–5</th>
                    <th className="p-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.preview.map((pr) => (
                    <tr
                      key={pr.row}
                      className={`border-t border-gray-100 dark:border-slate-700 ${pr.valid ? "bg-card" : "bg-red-50 dark:bg-red-950/30"}`}
                    >
                      <td className="p-2">{pr.row}</td>
                      <td className="p-2 font-mono text-fg">{pr.item_id || "—"}</td>
                      <td className="p-2">{pr.variation_id || "—"}</td>
                      <td className="max-w-[80px] truncate p-2">{pr.sku || "—"}</td>
                      <td className="max-w-[120px] truncate p-2" title={pr.title}>
                        {pr.title || "—"}
                      </td>
                      <td className="p-2">{pr.price_atual || "—"}</td>
                      <td className="p-2">{pr.promocao?.trim() ? pr.promocao : "—"}</td>
                      <td className="p-2">
                        {pr.tiers.length > 0
                          ? pr.tiers.map((t) => `${t.min_qty}→${t.price}`).join(", ")
                          : "—"}
                      </td>
                      <td className="p-2">
                        {pr.valid ? (
                          <span className="rounded bg-green-200 px-2 py-0.5 text-green-800">OK</span>
                        ) : (
                          <span className="rounded bg-red-200 px-2 py-0.5 text-red-800" title={pr.error}>
                            Erro
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            </div>
          )}
          {(importResult.errors?.length ?? 0) > 0 && (
            <div className="mb-4 max-h-40 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-sm">
              <p className="mb-2 font-medium text-red-800">Erros por linha:</p>
              <ul className="list-inside list-disc space-y-1 text-red-700">
                {(importResult.errors ?? []).slice(0, 50).map((err, idx) => (
                  <li key={idx}>
                    Linha {err.row}{err.field ? ` (${err.field})` : ""}: {err.message}
                  </li>
                ))}
                {(importResult.errors?.length ?? 0) > 50 && (
                  <li>… e mais {(importResult.errors?.length ?? 0) - 50} erros.</li>
                )}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmImport}
              disabled={importConfirming || importResult.valid_rows === 0}
              className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
            >
              {importConfirming ? "Importando…" : "Confirmar Importação"}
            </button>
            <button
              type="button"
              onClick={cancelImport}
              disabled={importConfirming}
              className="btn btn-secondary btn-sm disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loadingRows ? (
        <p className="px-3 py-6 text-sm text-slate-500 dark:text-slate-400">Atualizando lista…</p>
      ) : rows.length === 0 ? (
        <div className="px-3 py-6 text-sm text-slate-600 dark:text-slate-300">
          {rowsFetchError ? (
            <p className="text-red-700 dark:text-red-400">{rowsFetchError}</p>
          ) : (
            <>
              <p>
                Nenhum item encontrado
                {accounts.find((a) => a.id === accountId)?.ml_nickname
                  ? ` na conta «${accounts.find((a) => a.id === accountId)?.ml_nickname}».`
                  : "."}
              </p>
              {appliedAtacadoFilterLabels.length > 0 ? (
                <p className="mt-2 text-slate-500 dark:text-slate-400">
                  Há filtros ativos — use <strong>Limpar</strong> na barra de filtros ou confira se a conta no menu
                  superior é a mesma em que os anúncios foram sincronizados.
                </p>
              ) : (
                <p className="mt-2 text-slate-500 dark:text-slate-400">
                  Confira se a conta no menu superior é a correta. Se os anúncios aparecem em{" "}
                  <a href="/app/anuncios" className="text-brand-blue hover:underline">
                    Anúncios
                  </a>{" "}
                  mas não aqui, troque a conta no cabeçalho e atualize a tabela (menu ▾ → Atualizar tabela).
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="pricing-table-with-sticky adminty-table-card">
            <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-700">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                <span className="font-medium text-slate-800 dark:text-slate-100">{rows.length}</span>
                {" linhas na página · total "}
                <span className="font-medium text-slate-800 dark:text-slate-100">{total}</span>
                {totalItems > 0 && total !== totalItems && (
                  <>
                    {" · "}
                    <span className="font-medium text-slate-800 dark:text-slate-100">{totalItems}</span>
                    {" anúncio(s) no resultado"}
                  </>
                )}
              </p>
              <div className="flex items-center gap-2">
                <TablePageSizeSelect
                  value={pageSize}
                  options={TABLE_PAGE_SIZE_OPTIONS}
                  onChange={(next) => {
                    setPageSize(next);
                    setPage(1);
                  }}
                />
                {totalPages > 1 && (
                  <>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Página {page}/{totalPages}
                    </span>
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
              tableClassName="table-fixed"
              tableStyle={{ width: ATACADO_TABLE_TOTAL_WIDTH_PX, minWidth: ATACADO_TABLE_TOTAL_WIDTH_PX }}
            >
              <colgroup>
                {ATACADO_COLUMNS.map((c, i) => (
                  <col key={i} style={{ width: c.minWidth }} />
                ))}
              </colgroup>
              <thead ref={atacadoTheadRef} className="sticky top-0 z-10">
                <tr>
                  {renderAtacadoColumnHeader(0, "MLB", "whitespace-nowrap")}
                  {renderAtacadoColumnHeader(1, "Título")}
                  {renderAtacadoColumnHeader(2, "SKU", "", {
                    title:
                      "SKU do atributo SELLER_SKU. Itens: Anúncio → Atributos do produto. Variações: atributo SELLER_SKU em cada variação.",
                  })}
                  {renderAtacadoColumnHeader(3, "Preço R$", "tabular-nums")}
                  {renderAtacadoColumnHeader(4, "Promoção R$", "tabular-nums", {
                    title: "Valor salvo na calculadora (Preços / planned_prices)",
                  })}
                  {[1, 2, 3, 4, 5].map((n) => {
                    const t = n - 1;
                    const minIdx = 5 + t * 2;
                    const priceIdx = 6 + t * 2;
                    return (
                      <React.Fragment key={n}>
                        {renderAtacadoColumnHeader(minIdx, <>Qt. Atac. {n}</>, "whitespace-nowrap")}
                        {renderAtacadoColumnHeader(priceIdx, <>R$ Atac. {n}</>, "whitespace-nowrap")}
                      </React.Fragment>
                    );
                  })}
                  {renderAtacadoColumnHeader(ATACADO_STATUS_COL_INDEX, "Status")}
                  {renderAtacadoColumnHeader(ATACADO_ACTIONS_COL_INDEX, "Ações")}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => renderAtacadoRow(r))}
              </tbody>
            </AppTable>
          </div>
        </>
      )}
        </>
        )}

      </div>

      {receivableRowKey && (() => {
        const r = rows.find((x) => rowKey(x) === receivableRowKey);
        if (!r) return null;
        const cur = getEditState(r);
        const scenarios: { label: string; unitPrice: number }[] = [];
        const basePrice = r.current_price != null ? Number(r.current_price) : 0;
        if (basePrice > 0) scenarios.push({ label: "Base", unitPrice: basePrice });
        padSlots5(cur.slots).forEach((t, i) => {
          if (t && typeof t.min_qty === "number" && typeof t.price === "number" && t.price > 0) {
            scenarios.push({ label: `Atacado ${i + 1} (${t.min_qty}+)`, unitPrice: t.price });
          }
        });
        return (
          <ReceivableModal
            open={true}
            onClose={() => setReceivableRowKey(null)}
            accountId={accountId}
            listingTypeId={r.listing_type_id ?? null}
            categoryId={r.category_id ?? null}
            scenarios={scenarios}
            onFetchFees={async (prices) => {
              const res = await fetch("/api/atacado/fees/simulate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  accountId,
                  item_id: r.item_id,
                  variation_id: r.variation_id,
                  listing_type_id: r.listing_type_id,
                  category_id: r.category_id ?? undefined,
                  prices,
                }),
              });
              const data = await res.json();
              if (!res.ok || !data.ok || !Array.isArray(data.results)) return null;
              return data.results as { price: number; fee: number; net: number }[];
            }}
          />
        );
      })()}

      {filtersModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setFiltersModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Filtros de atacado"
        >
          <div
            className="modal-panel w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Filtros</h2>
                <p className="text-xs text-slate-500">Refine as linhas por MLB, SKU, tags de produto e mais.</p>
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
            <form onSubmit={handleFilterSubmit} className="flex max-h-[min(85vh,48rem)] flex-col gap-3 overflow-y-auto p-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">MLB</span>
                <input
                  type="text"
                  value={draftMlb}
                  onChange={(e) => setDraftMlb(e.target.value)}
                  placeholder="ex: MLB1234567890"
                  className="input font-mono text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">MLBU</span>
                <input
                  type="text"
                  value={draftMlbu}
                  onChange={(e) => setDraftMlbu(e.target.value)}
                  placeholder="ex: MLBU…"
                  className="input font-mono text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Título</span>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="Buscar no título…"
                  className="input"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">SKU</span>
                <input
                  type="text"
                  value={draftSku}
                  onChange={(e) => setDraftSku(e.target.value)}
                  placeholder="Filtrar por SKU…"
                  className="input font-mono text-xs"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Refino</span>
                <select
                  value={draftFilterExtra}
                  onChange={(e) => setDraftFilterExtra(e.target.value)}
                  className="input text-xs"
                >
                  <option value="">Nenhum</option>
                  <option value="mlbu">Só MLBU</option>
                  <option value="com_familia">Com família</option>
                  <option value="com_rascunho">Com rascunho</option>
                  <option value="sem_rascunho">Sem rascunho</option>
                  <option value="price_high">Preço alto (ref.)</option>
                </select>
              </div>
              {allTags.length > 0 && (
                <div>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tags do produto vinculado (qualquer uma)
                  </span>
                  <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                    {allTags.map((t) => (
                      <label
                        key={t.id}
                        className={`cursor-pointer rounded border px-2 py-1 text-xs ${
                          draftFilterTagIds.includes(t.id)
                            ? "border-[#0d6efd] bg-[#0d6efd]/10 text-[#0d6efd]"
                            : "border-slate-200 bg-card text-slate-700 dark:border-slate-600 dark:text-slate-200"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={draftFilterTagIds.includes(t.id)}
                          onChange={() => toggleDraftFilterTag(t.id)}
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
                <button
                  type="submit"
                  className="btn btn-primary w-full text-xs font-semibold"
                >
                  Aplicar filtros
                </button>
                {showFilterResetButton && (
                  <button
                    type="button"
                    onClick={() => clearFilters()}
                    className="w-full rounded border border-slate-300 bg-white py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Limpar filtros
                  </button>
                )}
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

export default function AtacadoPage() {
  return (
    <OnboardingGate required="catalog">
      <Suspense
        fallback={
          <div className="adminty-atacado-page space-y-5">
            <div className="table-page-shell p-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">Carregando…</p>
            </div>
          </div>
        }
      >
        <AtacadoPageContent />
      </Suspense>
    </OnboardingGate>
  );
}
