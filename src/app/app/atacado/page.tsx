"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppTable } from "@/components/AppTable";
import { OnboardingGate } from "@/components/OnboardingGate";
import { ReceivableModal } from "@/components/ReceivableModal";
import { SmartLoaderOverlay } from "@/components/SmartLoaderOverlay";
import { normalizeTiers, validateTiers, type Tier } from "@/lib/atacado";

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

const ATACADO_STICKY_STORAGE_KEY = "escalapreco.atacado.pinnedColumns.v1";

/** Larguras mínimas (px): alinhadas ao `<colgroup>` para `position: sticky` e `left`. */
const ATACADO_COLUMNS: { minWidth: number }[] = [
  { minWidth: 108 },
  { minWidth: 108 },
  { minWidth: 180 },
  { minWidth: 80 },
  { minWidth: 120 },
  { minWidth: 88 },
  { minWidth: 96 },
  { minWidth: 76 },
  { minWidth: 92 },
  { minWidth: 76 },
  { minWidth: 92 },
  { minWidth: 76 },
  { minWidth: 92 },
  { minWidth: 76 },
  { minWidth: 92 },
  { minWidth: 76 },
  { minWidth: 92 },
  { minWidth: 100 },
  { minWidth: 120 },
];

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
    return new Set(nums);
  } catch {
    return new Set();
  }
}

/** Ícone de alfinete para congelar/descongelar coluna no cabeçalho */
function PinIcon({ pinned, className }: { pinned: boolean; className?: string }) {
  const pathD = "M16 12V4h1V2H7v2h1v8l-4 4v2h12v-2l-4-4z";
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={pinned ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={pathD} />
    </svg>
  );
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
      className={`inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-fg hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-slate-600/80 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

type RowStatus = "saved" | "edited" | "error";
type RowEditState = {
  tiers: Tier[];
  status: RowStatus;
  error?: string;
};

function ensureTiers5(tiers: Tier[]): (Tier | null)[] {
  const result: (Tier | null)[] = Array(5).fill(null);
  for (let i = 0; i < Math.min(5, tiers.length); i++) {
    result[i] = tiers[i] ?? null;
  }
  return result;
}

/** Mesma regra de `updateTier`: só mantém faixas com min_qty ≥ 2 e ordena. */
function tiersFromSlots(slots: (Tier | null)[]): Tier[] {
  const toKeep = slots.filter((x): x is Tier => x != null && x.min_qty >= 2);
  return [...toKeep].sort((a, b) => a.min_qty - b.min_qty);
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
  const [saving, setSaving] = useState(false);
  
  /** Painel de filtros lateral (só critérios de atacado) */
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [draftMlb, setDraftMlb] = useState("");
  const [draftMlbu, setDraftMlbu] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSku, setDraftSku] = useState("");
  const [draftVariation, setDraftVariation] = useState<"" | "com" | "sem">("");
  const [draftFilterExtra, setDraftFilterExtra] = useState("");
  const [draftHideVariations, setDraftHideVariations] = useState(false);
  const [filtersApplied, setFiltersApplied] = useState<{
    mlb: string;
    mlbu: string;
    title: string;
    sku: string;
    variation: "" | "com" | "sem";
    filterExtra: string;
    hideVariations: boolean;
  }>({
    mlb: "",
    mlbu: "",
    title: "",
    sku: "",
    variation: "",
    filterExtra: "",
    hideVariations: false,
  });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importConfirming, setImportConfirming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [applyJobId, setApplyJobId] = useState<string | null>(null);
  const [applyJob, setApplyJob] = useState<{
    job: { id: string; status: string; total: number; processed: number; ok: number; errors: number };
    logs: Array<{ item_id: string | null; variation_id: number | null; status: string; message: string | null; response_json?: unknown }>;
  } | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);

  /** Texto digitado no campo de preço (por linha e tier) para permitir decimais com vírgula enquanto digita */
  const [editingPrice, setEditingPrice] = useState<Record<string, string>>({});

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

  const searchParams = useSearchParams();
  const rowKey = (r: AtacadoRow) => `${r.item_id}:${r.variation_id ?? "item"}`;

  const [stickyColumns, setStickyColumns] = useState<Set<number>>(() => new Set());
  const [stickyHydrated, setStickyHydrated] = useState(false);

  useEffect(() => {
    setStickyColumns(readAtacadoStickyInitial());
    setStickyHydrated(true);
  }, []);

  const toggleStickyColumn = useCallback((colIndex: number) => {
    setStickyColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colIndex)) next.delete(colIndex);
      else next.add(colIndex);
      return next;
    });
  }, []);

  const { stickyHeaderStyles, stickyBodyStyles } = useMemo(() => {
    const len = ATACADO_COLUMNS.length;
    const head: (CSSProperties | undefined)[] = Array.from({ length: len }, () => undefined);
    const body: (CSSProperties | undefined)[] = Array.from({ length: len }, () => undefined);
    let left = 0;
    let order = 0;
    for (let i = 0; i < len; i++) {
      if (stickyColumns.has(i)) {
        const w = ATACADO_COLUMNS[i].minWidth;
        const base = { position: "sticky" as const, left, boxSizing: "border-box" as const };
        head[i] = { ...base, zIndex: 30 + order };
        body[i] = { ...base, zIndex: 2 + order };
        left += w;
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

  function renderPinnedHeaderCell(
    colIndex: number,
    headerClassName: string,
    label: React.ReactNode,
    thProps?: React.ThHTMLAttributes<HTMLTableCellElement>
  ) {
    const pinned = stickyColumns.has(colIndex);
    return (
      <th
        className={`${headerClassName} ${pinned ? "sticky-col" : ""}`}
        style={stickyHeaderStyles[colIndex]}
        {...thProps}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="min-w-0">{label}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleStickyColumn(colIndex);
            }}
            title={pinned ? "Descongelar coluna" : "Congelar coluna"}
            className="shrink-0 rounded p-0.5 text-slate-500 opacity-70 hover:bg-slate-200 hover:opacity-100 dark:text-slate-400 dark:hover:bg-slate-600"
          >
            <PinIcon pinned={pinned} className={pinned ? "text-primary" : ""} />
          </button>
        </div>
      </th>
    );
  }

  /** Renderiza uma linha editável */
  function renderAtacadoRow(r: AtacadoRow) {
    const cur = getEditState(r);
    const tiers5 = ensureTiers5(cur.tiers);
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
          "p-2",
          <button type="button" onClick={() => copyToClipboard(r.item_id, `${rowKey(r)}-mlb`)} title="Clique para copiar" className="font-mono text-fg hover:bg-gray-100 rounded px-1 py-0.5 -mx-1 text-left cursor-pointer">
            {copiedCell === `${rowKey(r)}-mlb` ? <span className="text-emerald-600 text-xs font-medium">Copiado!</span> : r.item_id}
          </button>
        )}
        {stickyTd(
          1,
          "p-2",
          r.user_product_id ? (
            <button type="button" onClick={() => copyToClipboard(r.user_product_id ?? "", `${rowKey(r)}-mlbu`)} title="Clique para copiar" className="font-mono text-fg hover:bg-gray-100 rounded px-1 py-0.5 -mx-1 text-left cursor-pointer">
              {copiedCell === `${rowKey(r)}-mlbu` ? <span className="text-emerald-600 text-xs font-medium">Copiado!</span> : r.user_product_id}
            </button>
          ) : (
            <span className="text-fg-muted">—</span>
          )
        )}
        {stickyTd(2, "max-w-[180px] truncate p-2", <span title={r.title ?? ""}>{r.title ?? "—"}</span>)}
        {stickyTd(
          3,
          "p-2",
          r.has_variations ? (
            <span className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">Sim</span>
          ) : (
            <span className="text-fg-muted">Não</span>
          )
        )}
        {stickyTd(
          4,
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
        {stickyTd(5, "p-2 tabular-nums", r.current_price != null ? Number(r.current_price).toFixed(2) : "—")}
        {stickyTd(
          6,
          "p-2 text-right tabular-nums",
          r.planned_price != null && !Number.isNaN(Number(r.planned_price)) ? Number(r.planned_price).toFixed(2) : "—"
        )}
        {[0, 1, 2, 3, 4].map((i) => {
          const priceInputKey = `${rowKey(r)}-${i}`;
          const priceDisplay = editingPrice[priceInputKey] !== undefined ? editingPrice[priceInputKey] : tiers5[i]?.price != null ? formatPriceDisplay(tiers5[i].price) : "";
          const minCol = 7 + i * 2;
          const priceCol = 8 + i * 2;
          return (
            <React.Fragment key={i}>
              {stickyTd(
                minCol,
                "p-2",
                <input type="number" min={2} step={1} placeholder={i === 0 ? "2" : ""} value={tiers5[i]?.min_qty ?? ""} onChange={(e) => updateTier(r, i, "min_qty", e.target.value)} className={`w-16 rounded border px-1 py-0.5 text-sm ${isInvalid ? "border-red-500" : "border-gray-200"}`} />
              )}
              {stickyTd(
                priceCol,
                "p-2",
                <input type="text" inputMode="decimal" placeholder="0,00" value={priceDisplay} onChange={(e) => setEditingPrice((prev) => ({ ...prev, [priceInputKey]: e.target.value }))} onBlur={(e) => { const raw = e.target.value.trim(); const parsed = raw !== "" ? parsePriceInput(raw) : tiers5[i]?.price ?? 0; updateTier(r, i, "price", parsed); setEditingPrice((prev) => { const next = { ...prev }; delete next[priceInputKey]; return next; }); }} className={`w-20 rounded border px-1 py-0.5 text-sm ${isInvalid ? "border-red-500" : "border-gray-200"}`} />
              )}
            </React.Fragment>
          );
        })}
        {stickyTd(
          17,
          "p-2",
          <span className={`rounded px-2 py-0.5 text-xs ${cur.status === "error" ? "bg-red-200 text-red-800" : cur.status === "edited" ? "bg-amber-200 text-amber-800" : "bg-green-100 text-green-800"}`}>{cur.status === "error" ? "erro" : cur.status === "edited" ? "alterado" : "salvo"}</span>
        )}
        {stickyTd(
          18,
          "p-2",
          <div className="flex flex-wrap items-center justify-end gap-0.5">
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
      const accs = data.accounts ?? [];
      setAccounts(accs);
      if (accs.length > 0 && !accountId) {
        setAccountId(accs[0].id);
      }
    }
    setAccountsLoaded(true);
  }, [accountId]);

  const loadRows = useCallback(async (forceRefresh = false) => {
    if (!accountId) return;
    setLoadingRows(true);
    const params = new URLSearchParams({ accountId, page: String(page), limit: String(pageSize) });
    if (filtersApplied.mlb.trim()) params.set("mlb", filtersApplied.mlb.trim());
    if (filtersApplied.mlbu.trim()) params.set("mlbu_code", filtersApplied.mlbu.trim());
    if (filtersApplied.title.trim()) params.set("title", filtersApplied.title.trim());
    if (filtersApplied.sku.trim()) params.set("sku", filtersApplied.sku.trim());
    if (filtersApplied.variation) params.set("variation", filtersApplied.variation);
    if (filtersApplied.filterExtra) params.set("filter", filtersApplied.filterExtra);
    if (filtersApplied.hideVariations) params.set("hide_variations", "true");
    if (forceRefresh) params.set("_", String(Date.now()));
    const res = await fetch(`/api/atacado/rows?${params}`);
    if (res.ok) {
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      setTotalItems(data.totalItems ?? 0);
      setEdits({});
    }
    setLoadingRows(false);
  }, [accountId, page, pageSize, filtersApplied]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // Se não houver contas após carregar, não há rows para carregar
  useEffect(() => {
    if (accountsLoaded && accounts.length === 0) {
      setLoadingRows(false);
    }
  }, [accountsLoaded, accounts.length]);

  const urlAccountId = searchParams.get("accountId");
  const urlFilter = searchParams.get("filter");
  useEffect(() => {
    if (urlAccountId && accounts.some((a) => a.id === urlAccountId)) {
      setAccountId(urlAccountId);
    }
  }, [urlAccountId, accounts]);
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

  const handleFilterSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setFiltersApplied({
      mlb: draftMlb.trim(),
      mlbu: draftMlbu.trim(),
      title: draftTitle.trim(),
      sku: draftSku.trim(),
      variation: draftVariation,
      filterExtra: draftFilterExtra,
      hideVariations: draftHideVariations,
    });
    setPage(1);
    setFilterPanelOpen(false);
  }, [draftMlb, draftMlbu, draftTitle, draftSku, draftVariation, draftFilterExtra, draftHideVariations]);

  const clearFilters = useCallback(() => {
    setDraftMlb("");
    setDraftMlbu("");
    setDraftTitle("");
    setDraftSku("");
    setDraftVariation("");
    setDraftFilterExtra("");
    setDraftHideVariations(false);
    setFiltersApplied({
      mlb: "",
      mlbu: "",
      title: "",
      sku: "",
      variation: "",
      filterExtra: "",
      hideVariations: false,
    });
    setPage(1);
  }, []);

  const showFilterResetButton =
    draftMlb ||
    draftMlbu ||
    draftTitle ||
    draftSku ||
    draftVariation ||
    draftFilterExtra ||
    draftHideVariations;

  const filterPanelHasActiveDot = Boolean(
    filtersApplied.mlb ||
      filtersApplied.mlbu ||
      filtersApplied.title ||
      filtersApplied.sku ||
      filtersApplied.variation ||
      filtersApplied.filterExtra ||
      filtersApplied.hideVariations
  );

  useEffect(() => {
    if (accountId) loadRows();
  }, [accountId, loadRows]);


  const editedCount = Object.values(edits).filter((e) => e.status === "edited" || e.status === "error").length;

  const getEditState = (r: AtacadoRow): RowEditState => {
    const key = rowKey(r);
    return edits[key] ?? { tiers: r.tiers, status: "saved" };
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

  const updateTier = (r: AtacadoRow, tierIdx: number, field: "min_qty" | "price", value: string | number) => {
    const key = rowKey(r);
    const cur = getEditState(r);
    const tiers5 = ensureTiers5(cur.tiers);
    const newTiers: (Tier | null)[] = [...tiers5];
    if (newTiers[tierIdx] == null) {
      newTiers[tierIdx] = { min_qty: 2, price: 0 };
    }
    const t = { ...newTiers[tierIdx]! };
    if (field === "min_qty") {
      t.min_qty = typeof value === "string" ? parseInt(value, 10) || 0 : value;
    } else {
      t.price = typeof value === "string" ? parsePriceInput(value) : value;
    }
    newTiers[tierIdx] = t;
    const toKeep = newTiers.filter((x): x is Tier => x != null && x.min_qty >= 2);
    const sorted = [...toKeep].sort((a, b) => a.min_qty - b.min_qty);
    setEdits((prev) => ({
      ...prev,
      [key]: { tiers: sorted, status: "edited" },
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
    setEdits((prev) => {
      const next = { ...prev };
      for (const r of rows) {
        const key = rowKey(r);
        const cur = next[key] ?? { tiers: r.tiers, status: "saved" as RowStatus };
        const tiers5 = ensureTiers5(cur.tiers);
        const slots: (Tier | null)[] = [...tiers5];
        if (slots[bulkTierIdx] == null) {
          slots[bulkTierIdx] = { min_qty: minQty, price: 0 };
        } else {
          slots[bulkTierIdx] = { ...slots[bulkTierIdx]!, min_qty: minQty };
        }
        next[key] = { tiers: tiersFromSlots(slots), status: "edited" };
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
    setMessage({
      type: "success",
      text: `Quantidade mínima ${minQty} aplicada em Atacado ${bulkTierIdx + 1} em ${rows.length} linha(s). Faixas novas podem ficar sem preço válido até você preencher ou aplicar o desconto em massa no preço.`,
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
        const cur = next[key] ?? { tiers: r.tiers, status: "saved" as RowStatus };
        const tiers5 = ensureTiers5(cur.tiers);
        const slots: (Tier | null)[] = [...tiers5];
        if (slots[bulkTierIdx] == null) {
          slots[bulkTierIdx] = { min_qty: 2, price: newPrice };
        } else {
          slots[bulkTierIdx] = { ...slots[bulkTierIdx]!, price: newPrice };
        }
        next[key] = { tiers: tiersFromSlots(slots), status: "edited" };
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
        next[rowKey(r)] = { tiers: [], status: "edited" };
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
    setMessage({
      type: "success",
      text: `Faixas de atacado limpas em ${rows.length} linha(s). Clique em «Salvar alterações» para remover os rascunhos no banco.`,
    });
  }, [rows]);

  const revertRow = (r: AtacadoRow) => {
    const key = rowKey(r);
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validateRow = (r: AtacadoRow): string | null => {
    const cur = getEditState(r);
    const t = cur.tiers;
    if (t.length === 0) return null;
    const minQtys = new Set<number>();
    for (let i = 0; i < t.length; i++) {
      if (t[i].min_qty < 2 || !Number.isInteger(t[i].min_qty)) return `Atacado ${i + 1}: quantidade mínima deve ser inteiro >= 2`;
      if (t[i].price <= 0) return `Atacado ${i + 1}: preço deve ser > 0`;
      if (minQtys.has(t[i].min_qty)) return "Quantidades mínimas duplicadas";
      minQtys.add(t[i].min_qty);
    }
    const sorted = [...t].sort((a, b) => a.min_qty - b.min_qty);
    if (JSON.stringify(t) !== JSON.stringify(sorted)) return "Atacado: faixas devem estar em ordem crescente por quantidade mínima";
    return null;
  };

  const saveRow = async (r: AtacadoRow) => {
    const cur = getEditState(r);
    const normalized = normalizeTiers(cur.tiers);
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
      const normalized = normalizeTiers(getEditState(r).tiers);
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
    if (filtersApplied.variation) params.set("variation", filtersApplied.variation);
    if (filtersApplied.filterExtra) params.set("filter", filtersApplied.filterExtra);
    if (filtersApplied.hideVariations) params.set("hide_variations", "true");
    window.open(`/api/atacado/export?${params}`, "_blank");
    setMessage({ type: "success", text: "Exportação iniciada." });
  };

  const openImportCsv = () => {
    setImportResult(null);
    setImportFile(null);
    fileInputRef.current?.click();
  };

  const onImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
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

  const totalPages = Math.ceil(total / pageSize) || 1;

  if (!accountsLoaded) {
    return (
      <div className="rounded-app bg-white/90 p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800/90 dark:ring-slate-600">
        <div className="flex flex-col items-center justify-center py-8">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-primary"></div>
          <p className="text-sm text-slate-500">Carregando…</p>
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
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

  const atacadoLoaderMessages = [
    "Carregando anúncios…",
    "Buscando itens e variações no banco…",
    "Mesclando rascunhos de atacado…",
    "Montando a grade de preços…",
  ] as const;
  const applyLoaderMessages = [
    "Enviando preços de atacado ao Mercado Livre…",
    "Cada anúncio é atualizado na API do ML…",
    "Aguarde — volumes grandes podem levar alguns minutos…",
  ] as const;

  const smartLoaderOpen = loadingRows || applyJob != null;
  const applyDeterminatePercent = (() => {
    if (loadingRows || !applyJob) return undefined;
    const { total, processed, status } = applyJob.job;
    if (total > 0) return Math.min(100, (processed / total) * 100);
    if (status === "queued" || status === "running") return undefined;
    return 100;
  })();

  return (
    <div className="rounded-app bg-white/90 p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800/90 dark:ring-slate-600">
      <SmartLoaderOverlay
        open={smartLoaderOpen}
        messages={loadingRows ? [...atacadoLoaderMessages] : applyJob != null ? [...applyLoaderMessages] : [...atacadoLoaderMessages]}
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
      <div className="flex w-full min-h-0 gap-4">
        <aside
          className={`flex shrink-0 flex-col self-start rounded-r-lg border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800 shadow-sm transition-[width] duration-200 ease-out ${
            filterPanelOpen ? "w-[280px]" : "w-10"
          }`}
        >
          {filterPanelOpen ? (
            <div className="flex max-h-[min(85vh,48rem)] flex-col gap-3 overflow-y-auto p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filtros</span>
                <button
                  type="button"
                  onClick={() => setFilterPanelOpen(false)}
                  className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                  title="Fechar"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <form onSubmit={handleFilterSubmit} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">MLB</span>
                  <input
                    type="text"
                    value={draftMlb}
                    onChange={(e) => setDraftMlb(e.target.value)}
                    placeholder="ex: MLB1234567890"
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">MLBU</span>
                  <input
                    type="text"
                    value={draftMlbu}
                    onChange={(e) => setDraftMlbu(e.target.value)}
                    placeholder="ex: MLBU…"
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Título</span>
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    placeholder="Buscar no título…"
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">SKU</span>
                  <input
                    type="text"
                    value={draftSku}
                    onChange={(e) => setDraftSku(e.target.value)}
                    placeholder="Filtrar por SKU…"
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Variação</span>
                  <select
                    value={draftVariation}
                    onChange={(e) => setDraftVariation(e.target.value as "" | "com" | "sem")}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="">Todas</option>
                    <option value="com">Com variação</option>
                    <option value="sem">Sem variação</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500 dark:text-slate-400">Refino</span>
                  <select
                    value={draftFilterExtra}
                    onChange={(e) => setDraftFilterExtra(e.target.value)}
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="">Nenhum</option>
                    <option value="mlbu">Só MLBU</option>
                    <option value="com_familia">Com família</option>
                    <option value="com_rascunho">Com rascunho</option>
                    <option value="sem_rascunho">Sem rascunho</option>
                    <option value="price_high">Preço alto (ref.)</option>
                  </select>
                </div>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={draftHideVariations}
                    onChange={(e) => setDraftHideVariations(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  <span className="text-xs text-slate-700 dark:text-slate-200">Só anúncios (ocultar variações)</span>
                </label>
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="submit"
                    className="w-full rounded bg-primary py-2 text-xs font-semibold text-white hover:bg-primary-dark"
                  >
                    Aplicar filtros
                  </button>
                  {showFilterResetButton && (
                    <button
                      type="button"
                      onClick={() => clearFilters()}
                      className="w-full rounded border border-slate-300 bg-white py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/50"
                    >
                      Limpar filtros
                    </button>
                  )}
                </div>
              </form>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraftMlb(filtersApplied.mlb);
                setDraftMlbu(filtersApplied.mlbu);
                setDraftTitle(filtersApplied.title);
                setDraftSku(filtersApplied.sku);
                setDraftVariation(filtersApplied.variation);
                setDraftFilterExtra(filtersApplied.filterExtra);
                setDraftHideVariations(filtersApplied.hideVariations);
                setFilterPanelOpen(true);
              }}
              className="flex w-full flex-col items-center gap-0.5 py-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/50 dark:hover:text-slate-200"
              title="Abrir filtros"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                />
              </svg>
              {filterPanelHasActiveDot && (
                <span className="rounded-full bg-primary h-1.5 w-1.5" title="Filtros ativos" />
              )}
            </button>
          )}
        </aside>

        <main className="min-w-0 flex-1">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50 sm:text-xl">Editor de Preço de Atacado</h1>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 sm:text-sm">
            Defina faixas de quantidade e preços de atacado para seus anúncios.
          </p>
        </div>
      </div>

      {message && (
        <div
          className={`mb-4 rounded p-3 ${
            message.type === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Ações */}
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-app bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
        <button
          type="button"
          onClick={saveAll}
          disabled={saving || editedCount === 0}
          className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar alterações"}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-full border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50"
        >
          Exportar CSV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={onImportFileChange}
        />
        <button
          type="button"
          onClick={openImportCsv}
          disabled={importLoading}
          className="rounded-full border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importLoading ? "Processando…" : "Importar CSV"}
        </button>
        <button
          type="button"
          onClick={startApply}
          disabled={applyLoading || saving || !accountId}
          className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {applyLoading ? (editedCount > 0 ? "Salvando e aplicando…" : "Aplicando…") : "Aplicar Preços no Mercado Livre"}
        </button>
        <div className="relative" ref={bulkActionsRef}>
          <button
            type="button"
            onClick={() => setBulkActionsMenuOpen((o) => !o)}
            disabled={loadingRows || rows.length === 0}
            className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700/50"
          >
            Ações em massa
            <svg className="h-3.5 w-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {bulkActionsMenuOpen && (
            <div
              className="absolute left-0 top-full z-50 mt-1 min-w-[14rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-800"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-2 text-left text-xs text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-700/50"
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
                className="block w-full px-3 py-2 text-left text-xs text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-700/50"
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
                className="block w-full px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
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
        <span className="text-sm text-fg-muted">
          Aplicar envia os preços de atacado salvos para o Mercado Livre. Alterações não salvas serão salvas automaticamente ao clicar.
        </span>
        {editedCount > 0 && (
        <span className="text-xs font-medium text-amber-700">{editedCount} linha(s) alterada(s)</span>
        )}
      </div>

      {bulkMinQtyModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Fechar"
            onClick={() => setBulkMinQtyModalOpen(false)}
          />
          <div
            className="relative w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-600 dark:bg-slate-800"
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
                  type="number"
                  min={2}
                  step={1}
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
            className="relative max-h-[min(90vh,40rem)] w-full max-w-5xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-600 dark:bg-slate-800"
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
                      className={`border-t border-gray-100 ${pr.valid ? "bg-white" : "bg-red-50"}`}
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
          {importResult.errors.length > 0 && (
            <div className="mb-4 max-h-40 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-sm">
              <p className="mb-2 font-medium text-red-800">Erros por linha:</p>
              <ul className="list-inside list-disc space-y-1 text-red-700">
                {importResult.errors.slice(0, 50).map((err, idx) => (
                  <li key={idx}>
                    Linha {err.row}{err.field ? ` (${err.field})` : ""}: {err.message}
                  </li>
                ))}
                {importResult.errors.length > 50 && (
                  <li>… e mais {importResult.errors.length - 50} erros.</li>
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
              className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-fg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {loadingRows ? null : rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhum item encontrado. Sincronize anúncios em{" "}
          <a href="/app/anuncios" className="text-brand-blue hover:underline">
            Anúncios
          </a>
          .
        </p>
      ) : (
        <>
          <div className="pricing-table-with-sticky">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                <span className="font-medium text-slate-800 dark:text-slate-100">{rows.length}</span>
                {" linhas filtradas de "}
                <span className="font-medium text-slate-800 dark:text-slate-100">{total}</span>
                {totalItems > 0 && total !== totalItems && (
                  <>
                    {" · "}
                    <span className="font-medium text-slate-800 dark:text-slate-100">{totalItems}</span>
                    {" anúncio(s) no resultado"}
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <span>Linhas por página</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setPageSize(value);
                      setPage(1);
                    }}
                    className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={500}>500</option>
                    <option value={1000}>1000</option>
                  </select>
                </label>
                {totalPages > 1 && (
                  <>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Página {page} de {totalPages}
                    </span>
                    <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-1 text-xs ring-1 ring-slate-200 dark:bg-slate-700 dark:ring-slate-600">
                      <button
                        type="button"
                        onClick={() => setPage(1)}
                        disabled={page === 1}
                        className="rounded-full px-2 py-1 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Primeira página"
                      >
                        «
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="rounded-full px-2 py-1 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Anterior
                      </button>
                      <span className="min-w-[2ch] px-1.5 py-1 text-center font-semibold text-slate-800 dark:text-slate-100">
                        {page}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="rounded-full px-2 py-1 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Próxima
                      </button>
                      <button
                        type="button"
                        onClick={() => setPage(totalPages)}
                        disabled={page === totalPages}
                        className="rounded-full px-2 py-1 font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
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
              tableClassName="table-fixed w-max min-w-[max(100%,max-content)]"
            >
              <colgroup>
                {ATACADO_COLUMNS.map((c, i) => (
                  <col key={i} style={{ width: c.minWidth }} />
                ))}
              </colgroup>
              <thead className="bg-slate-50">
                <tr>
                  {renderPinnedHeaderCell(
                    0,
                    "whitespace-nowrap p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300",
                    "MLB"
                  )}
                  {renderPinnedHeaderCell(
                    1,
                    "whitespace-nowrap p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300",
                    "MLBU",
                    { title: "Código User Product (MLBU)" }
                  )}
                  {renderPinnedHeaderCell(
                    2,
                    "p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300",
                    "Título"
                  )}
                  {renderPinnedHeaderCell(
                    3,
                    "p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300",
                    "Variação",
                    { title: "Indica se o anúncio possui variações" }
                  )}
                  {renderPinnedHeaderCell(
                    4,
                    "p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300",
                    "SKU",
                    {
                      title:
                        "SKU do atributo SELLER_SKU. Itens: Anúncio → Atributos do produto. Variações: atributo SELLER_SKU em cada variação.",
                    }
                  )}
                  {renderPinnedHeaderCell(
                    5,
                    "p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300",
                    "Preço R$"
                  )}
                  {renderPinnedHeaderCell(
                    6,
                    "p-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300",
                    "Promoção R$",
                    { title: "Valor salvo na calculadora (Preços / planned_prices)" }
                  )}
                  {[1, 2, 3, 4, 5].map((n) => {
                    const t = n - 1;
                    const minIdx = 7 + t * 2;
                    const priceIdx = 8 + t * 2;
                    return (
                      <React.Fragment key={n}>
                        {renderPinnedHeaderCell(
                          minIdx,
                          "whitespace-nowrap p-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300",
                          <>Atacado {n} · mín.</>
                        )}
                        {renderPinnedHeaderCell(
                          priceIdx,
                          "whitespace-nowrap p-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300",
                          <>Atacado {n} · R$</>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {renderPinnedHeaderCell(
                    17,
                    "p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300",
                    "Status"
                  )}
                  {renderPinnedHeaderCell(
                    18,
                    "p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300",
                    "Ações"
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => renderAtacadoRow(r))}
              </tbody>
            </AppTable>
          </div>
        </>
      )}

      {receivableRowKey && (() => {
        const r = rows.find((x) => rowKey(x) === receivableRowKey);
        if (!r) return null;
        const cur = getEditState(r);
        const scenarios: { label: string; unitPrice: number }[] = [];
        const basePrice = r.current_price != null ? Number(r.current_price) : 0;
        if (basePrice > 0) scenarios.push({ label: "Base", unitPrice: basePrice });
        (cur.tiers ?? []).forEach((t, i) => {
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

        </main>
      </div>
    </div>
  );
}

export default function AtacadoPage() {
  return (
    <OnboardingGate required="catalog">
      <Suspense fallback={<div className="p-8 text-center">Carregando...</div>}>
        <AtacadoPageContent />
      </Suspense>
    </OnboardingGate>
  );
}
