"use client";

import {
  useCallback,
  useEffect,
  useState,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AppTable } from "@/components/AppTable";
import { TablePageSizeSelect } from "@/components/TablePageSizeSelect";
import { OnboardingGate } from "@/components/OnboardingGate";
import {
  apiListPage,
  computeTotalPages,
  isAllPageSize,
  PRECO_PAGE_SIZE_OPTIONS,
} from "@/lib/table-pagination";
import { SmartLoaderOverlay } from "@/components/SmartLoaderOverlay";
import {
  PRICING_CALCULATE_CLIENT_BATCH_SIZE,
  PRICING_IMPORT_CONFIRM_CLIENT_BATCH_SIZE,
} from "@/lib/pricing/calculate-limits";
import { calculateFullPricing as computeFullPricingBreakdown, type FullPricingBreakdown } from "@/lib/pricing/full-net";
import {
  effectiveCalcularFreteMl,
  isMercadoLiderPowerSeller,
  PRICING_FRETE_PREFERENCE_EVENT,
  readCalcularFretePreference,
} from "@/lib/pricing/mercado-lider-freight";
import {
  applyPriceRounding,
  formatTargetCentsLabel,
  loadPriceRoundingPreference,
  PRICING_ROUNDING_PREFERENCE_EVENT,
  readPriceRoundingPreference,
  type PriceRoundingConfig,
} from "@/lib/pricing/price-rounding";
import {
  sanitizeMlSellerCampaignNameInput,
  isValidMlSellerCampaignName,
  ML_SELLER_CAMPAIGN_NAME_HINT,
} from "@/lib/mercadolivre/campaign-name";
import {
  STOCK_COMPARE_OPS,
  stockCompareLabel,
  type StockCompareOp,
} from "@/lib/mercadolivre/item-tags";
import { splitMlActivePromotionsCell } from "@/lib/mercadolivre/seller-promotions-item";
import type { ProductTag } from "@/lib/db/types";
import {
  PRECOS_IMPORT_CSV_TEMPLATE_HEADER,
  parsePrecosImportCsv,
  type PrecosImportPreviewRow,
  type PrecosImportRowValid,
} from "@/lib/precos-import-csv";
import {
  clampPromoPriceToPmaFloor,
  formatPmaClampBulkSuffix,
  formatPmaClampSingleMessage,
} from "@/lib/pricing/pma-floor";
import { PrecosHelpContent } from "./precos-help-content";
import type { PrecosFiltersValues } from "./precos-filters-modal";
import type { ProductHasPmaFilter } from "@/lib/product-filters";
import { PrecosToolbarIcons } from "./precos-toolbar-icons";
import {
  consumePricingListingsStaleFlag,
  subscribePricingListingsRefresh,
} from "@/lib/pricing/listings-refresh-events";

interface PricingListing {
  id: string;
  item_id: string;
  variation_id: number | null;
  title: string | null;
  thumbnail: string | null;
  permalink: string | null;
  status: string | null;
  listing_type_id: string | null;
  category_id: string | null;
  current_price: number;
  sku: string | null;
  product_id: string | null;
  cost_price: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  account_id: string;
  ml_active_promotions?: string | null;
  /** % taxa ML (fee/preço) por categoria+tipo, preenchido no refresh do cache após sync */
  reference_fee_percent?: number | null;
  /** PMA (R$) do produto vinculado — piso da promoção */
  pma?: number | null;
}

type CalculatedPricing = FullPricingBreakdown;

interface ListingWithPricing extends PricingListing {
  new_price: number;
  calculated?: CalculatedPricing;
  calculating?: boolean;
  dirty?: boolean;
}

interface ReputationData {
  reputation?: {
    power_seller_status: string | null;
    level_id: string | null;
  };
}

type PriceReferenceStatus = "competitive" | "attention" | "high" | "none";

interface PriceReferenceCell {
  status: string;
  suggested_price: number | null;
  min_reference_price: number | null;
  max_reference_price: number | null;
  explanation: string | null;
  updated_at: string | null;
}

function priceRefRowKey(itemId: string, variationId: number | null): string {
  return `${String(itemId).trim().toUpperCase()}:${variationId ?? "item"}`;
}

function competitivenessBadge(status: string | undefined): { label: string; className: string } {
  switch (status as PriceReferenceStatus) {
    case "competitive":
      return { label: "Competitivo", className: "bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-200" };
    case "attention":
      return { label: "Atenção", className: "bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" };
    case "high":
      return { label: "Preço alto", className: "bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-200" };
    default:
      return { label: "Sem referência", className: "bg-gray-200 text-fg dark:bg-slate-600 dark:text-slate-200" };
  }
}

function LinkStatusIcon({ linked }: { linked: boolean }) {
  // SVG inline para evitar dependências e sem fetch extra
  if (linked) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        className="h-3.5 w-3.5 text-slate-400 dark:text-slate-300"
      >
        <path
          d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0 0-7.07a5 5 0 0 0-7.07 0L10.5 5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M14 11a5 5 0 0 0-7.07 0L5.5 12.5a5 5 0 0 0 0 7.07a5 5 0 0 0 7.07 0L13.5 19"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  // "link-2-off": mesmo ícone com barra diagonal
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className="h-3.5 w-3.5 text-slate-400 dark:text-slate-300"
    >
      <path
        d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0 0-7.07a5 5 0 0 0-7.07 0L10.5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 11a5 5 0 0 0-7.07 0L5.5 12.5a5 5 0 0 0 0 7.07a5 5 0 0 0 7.07 0L13.5 19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 3l18 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mesmo padrão visual do badge de Competitividade (`inline-flex rounded px-2 py-0.5 text-xs font-medium`). */
function mlPromotionsBadge(count: number): { label: string; className: string } {
  if (count <= 0) {
    return { label: "0", className: "bg-gray-200 text-fg dark:bg-slate-600 dark:text-slate-200" };
  }
  return {
    label: count === 1 ? "1 campanha" : `${count} campanhas`,
    className: "bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-200",
  };
}

function MlActivePromotionsCell({ text }: { text: string | null | undefined }) {
  const lines = splitMlActivePromotionsCell(text ?? "");
  const count = lines.length;
  const { label, className } = mlPromotionsBadge(count);
  const title =
    count > 0
      ? lines.join("\n")
      : "Nenhuma promoção ativa no cache. Atualize em Promoções (Recarregar) e depois o cache de Preços.";
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${className}`} title={title}>
      {label}
    </span>
  );
}

function skuDisplayParts(rawSku: string): { primary: string; extraCount: number } {
  const text = rawSku.trim();
  if (!text) return { primary: "", extraCount: 0 };

  const plusMatch = text.match(/\(\+(\d+)\s*SKUs?\)/i);
  const plusCount = plusMatch ? Number(plusMatch[1]) : 0;
  const withoutPlus = text.replace(/\s*\(\+\d+\s*SKUs?\)\s*/i, "").trim();
  const parts = withoutPlus
    .split("·")
    .map((p) => p.trim())
    .filter((p) => p && p !== "…");

  const primary = parts[0] ?? withoutPlus;
  const extraCount = plusCount > 0 ? plusCount : Math.max(0, parts.length - 1);
  return { primary, extraCount };
}

const ML_MIN_CAMPAIGN_DISCOUNT_PERCENT = 5;
const ML_MAX_CAMPAIGN_DISCOUNT_PERCENT = 80;

/** Mercado Livre exige desconto mínimo de 5% na campanha: preço calculado deve ser ≤ 95% do preço ML. */
function meetsMlMinCampaignDiscount(listing: Pick<ListingWithPricing, "current_price" | "new_price">): boolean {
  if (listing.current_price <= 0 || listing.new_price <= 0) return false;
  const maxPromoOverCurrent = 1 - ML_MIN_CAMPAIGN_DISCOUNT_PERCENT / 100;
  return listing.new_price <= listing.current_price * maxPromoOverCurrent;
}

function promotionPriceForDiscountPercent(currentPrice: number, discountPercent: number): number {
  const pct = Math.min(ML_MAX_CAMPAIGN_DISCOUNT_PERCENT, Math.max(ML_MIN_CAMPAIGN_DISCOUNT_PERCENT, discountPercent));
  const factor = 1 - pct / 100;
  return Math.floor(currentPrice * factor * 100) / 100;
}

/** Ajusta preços em mapa ao PMA de cada anúncio; retorna quantos foram limitados. */
function clampPriceMapToListingPma(
  listings: ListingWithPricing[],
  priceByKey: Map<string, number>
): number {
  let clampedCount = 0;
  for (const listing of listings) {
    const key = listingSelectionKey(listing);
    const raw = priceByKey.get(key);
    if (raw == null) continue;
    const { price, clamped } = clampPromoPriceToPmaFloor(raw, listing.pma);
    priceByKey.set(key, price);
    if (clamped) clampedCount++;
  }
  return clampedCount;
}

/** Desconto % entre preço ML (current_price) e promoção planejada (new_price). */
function getPromotionDiscountPercent(
  listing: Pick<ListingWithPricing, "current_price" | "new_price">
): number | null {
  const price = Number(listing.current_price);
  const promo = Number(listing.new_price);
  if (!Number.isFinite(price) || !Number.isFinite(promo) || price <= 0) return null;
  if (Math.round(promo * 100) === Math.round(price * 100)) return 0;
  const pct = ((price - promo) / price) * 100;
  return Math.round(pct * 100) / 100;
}

/** Resposta por item em POST /api/mercadolivre/seller-campaigns */
type SellerCampaignItemResult =
  | { item_id: string; variation_id: number | null; status: "ok"; price: number }
  | { item_id: string; variation_id: number | null; status: "skipped_no_planned_price" }
  | { item_id: string; variation_id: number | null; status: "error"; error: string };

/** Resposta por item em POST /api/mercadolivre/update-item-prices */
type UpdatePriceItemResult =
  | { item_id: string; variation_id: number | null; status: "ok"; price: number; warnings?: string[] }
  | { item_id: string; variation_id: number | null; status: "skipped_invalid_price" }
  | { item_id: string; variation_id: number | null; status: "error"; error: string };

function escapeCsvField(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Itens não incluídos na campanha: separador `;` e BOM UTF-8 para Excel em PT-BR. */
function buildCampaignIssuesCsv(rows: SellerCampaignItemResult[]): string {
  const sep = ";";
  const header = ["item_id", "variation_id", "situacao", "mensagem"];
  const lines: string[] = [header.map(escapeCsvField).join(sep)];
  for (const r of rows) {
    if (r.status === "ok") continue;
    const vid = r.variation_id == null ? "" : String(r.variation_id);
    if (r.status === "error") {
      lines.push([r.item_id, vid, "erro_api", r.error].map(escapeCsvField).join(sep));
    } else {
      lines.push(
        [
          r.item_id,
          vid,
          "sem_preco_salvo",
          "Sem preço planejado gravado (planned_price) para esta linha",
        ]
          .map(escapeCsvField)
          .join(sep)
      );
    }
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

function updatePriceRowKey(item_id: string, variation_id: number | null): string {
  return `${item_id}:${variation_id ?? "n"}`;
}

type UpdatePriceModalResult = {
  globalError?: string;
  summary: { applied: number; skipped: number; errors: number };
  items: UpdatePriceItemResult[];
  labelsByKey: Record<string, string>;
};

function buildUpdatePriceIssuesCsv(rows: UpdatePriceItemResult[]): string {
  const sep = ";";
  const header = ["item_id", "variation_id", "situacao", "mensagem"];
  const lines: string[] = [header.map(escapeCsvField).join(sep)];
  for (const r of rows) {
    if (r.status === "ok") continue;
    const vid = r.variation_id == null ? "" : String(r.variation_id);
    if (r.status === "error") {
      lines.push([r.item_id, vid, "erro_api", r.error].map(escapeCsvField).join(sep));
    } else {
      lines.push(
        [r.item_id, vid, "promocao_invalida", "Preço Calculado inválido ou zero na linha selecionada"]
          .map(escapeCsvField)
          .join(sep)
      );
    }
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

const PRECOS_EXPORT_CSV_HEADERS = [
  "MLB",
  "Variacao",
  "Titulo",
  "SKU",
  "Vendas 30d",
  "Preco ML",
  "Margem %",
  "Preco Calculado",
  "Preco Final",
  "Vai Receber",
  "Lucro",
  "Lucro %",
  "Taxa ML",
  "Taxa ML %",
  "Frete",
  "Custo",
  "Imposto",
  "Taxa Extra",
  "Desp. Fixas",
  "Promo ML",
  "Competitividade",
  "Link",
] as const;

function csvExportDecimal(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toFixed(digits);
}

function buildPrecosExportCsv(
  rows: ListingWithPricing[],
  ordersData: Record<string, number>,
  priceRefsByRow: Record<string, PriceReferenceCell>,
  getProfitPercent: (listing: ListingWithPricing) => number | null,
  priceRounding: PriceRoundingConfig
): string {
  const sep = ";";
  const lines: string[] = [PRECOS_EXPORT_CSV_HEADERS.map((h) => escapeCsvField(h)).join(sep)];

  for (const listing of rows) {
    const ref = priceRefsByRow[priceRefRowKey(listing.item_id, listing.variation_id)];
    const compLabel = competitivenessBadge(ref?.status ?? "none").label;
    const promoLines = splitMlActivePromotionsCell(listing.ml_active_promotions);
    const promoMl = promoLines.length > 0 ? promoLines.join(" | ") : "0";

    const profit =
      listing.calculated && listing.cost_price != null
        ? listing.calculated.net_amount - listing.cost_price
        : null;
    const profitPercent = getProfitPercent(listing);

    const mlFeeSharePct =
      listing.calculated && listing.calculated.price > 0
        ? (listing.calculated.fee / listing.calculated.price) * 100
        : listing.reference_fee_percent != null && Number.isFinite(Number(listing.reference_fee_percent))
          ? Number(listing.reference_fee_percent)
          : null;

    lines.push(
      [
        listing.item_id,
        listing.variation_id ?? "",
        listing.title ?? "",
        listing.sku ?? "",
        ordersData[listing.item_id] ?? "",
        csvExportDecimal(listing.current_price),
        csvExportDecimal(profitPercent, 1),
        csvExportDecimal(listing.new_price),
        csvExportDecimal(applyPriceRounding(listing.new_price, priceRounding)),
        csvExportDecimal(listing.calculated?.vai_receber),
        csvExportDecimal(profit),
        csvExportDecimal(profitPercent, 1),
        csvExportDecimal(listing.calculated?.fee),
        csvExportDecimal(mlFeeSharePct, 1),
        csvExportDecimal(listing.calculated?.shipping_cost),
        csvExportDecimal(listing.cost_price),
        csvExportDecimal(listing.calculated?.tax_amount),
        csvExportDecimal(listing.calculated?.extra_fee_amount),
        csvExportDecimal(listing.calculated?.fixed_expenses_amount),
        promoMl,
        compLabel,
        listing.permalink ?? "",
      ]
        .map(escapeCsvField)
        .join(sep)
    );
  }

  return `\uFEFF${lines.join("\r\n")}`;
}

/** Configuração das colunas da tabela de preços (ordem = índice na tabela). Usado para congelar colunas. */
/** Ícone do Mercado Livre para link "Ver no ML" — usa favicon oficial */
function MLIcon({ className }: { className?: string }) {
  return (
    <img
      src="https://www.mercadolivre.com.br/favicon.ico"
      alt=""
      width={20}
      height={20}
      className={className}
    />
  );
}

const PRICING_COLUMNS: { label: string; minWidth: number }[] = [
  { label: "Seleção", minWidth: 44 },
  { label: "Imagem", minWidth: 52 },
  { label: "MLB", minWidth: 100 },
  /** Largura da coluna (colgroup + sticky `left`); 2 linhas no corpo */
  { label: "Título", minWidth: 300 },
  /** SKU costuma ser longo — evita truncar com col estreita */
  { label: "SKU", minWidth: 300 },
  { label: "Vendas 30d", minWidth: 88 },
  { label: "Preço", minWidth: 90 },
  { label: "Margem", minWidth: 76 },
  { label: "Preço Calculado", minWidth: 120 },
  { label: "Preço Final", minWidth: 100 },
  { label: "Vai Receber", minWidth: 95 },
  { label: "Lucro", minWidth: 95 },
  /** Valor R$ + % sobre Preço Calculado (ou referência), estilo Lucro */
  { label: "Taxa ML", minWidth: 82 },
  { label: "Frete", minWidth: 72 },
  { label: "Custo", minWidth: 80 },
  { label: "Imposto", minWidth: 80 },
  { label: "Taxa Extra", minWidth: 88 },
  { label: "Desp. Fixas", minWidth: 88 },
  { label: "Promo ML", minWidth: 120 },
  { label: "Competitividade", minWidth: 110 },
  { label: "Link", minWidth: 88 },
];

const PRICOS_STICKY_STORAGE_KEY = "escalapreco.precos.pinnedColumns.v6";
const PRICOS_STICKY_V5_KEY = "escalapreco.precos.pinnedColumns.v5";
const PRICOS_STICKY_V4_KEY = "escalapreco.precos.pinnedColumns.v4";
/** Layout anterior: Promo ML no índice 8, Preço no 7 — ver `swapPinnedPromoAndPriceColumnIndices`. */
const PRICOS_STICKY_V3_KEY = "escalapreco.precos.pinnedColumns.v3";
/** Valor anterior a `v3`: mesma tabela sem a coluna Promo ML (19 colunas, índices 0–18). */
const PRICOS_STICKY_PREV_TABLE_KEY = "escalapreco.precos.pinnedColumns.v2";
const PRICOS_STICKY_LEGACY_KEY = "escalapreco.precos.pinnedColumns.v1";

const PRICING_TABLE_COL_COUNT_BEFORE_PROMO_ML = 19;

/** Coluna Promo ML inserida após Preço (índice 8): índices fixos antigos ≥ 8 avançam 1. */
function bumpStickyIndicesAfterPromoMlColumn(nums: number[]): number[] {
  return nums.map((c) => (c >= 8 ? c + 1 : c));
}

/** v4 → v5: coluna Preço Final no índice 12; índices fixos antigos ≥ 12 avançam 1. */
function bumpStickyIndicesAfterPrecoFinalColumn(nums: number[]): number[] {
  return nums.map((c) => (c >= 12 ? c + 1 : c));
}

/** v5 → v6: Custo após Frete; Promo ML e Competitividade após Desp. Fixas. */
const STICKY_V5_TO_V6: Record<number, number> = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 14,
  7: 18,
  8: 6,
  9: 19,
  10: 7,
  11: 8,
  12: 9,
  13: 10,
  14: 11,
  15: 12,
  16: 13,
  17: 15,
  18: 16,
  19: 17,
  20: 20,
};

function migrateStickyV5ToV6(nums: number[]): number[] {
  const out = new Set<number>();
  for (const c of nums) {
    const mapped = STICKY_V5_TO_V6[c];
    if (mapped != null) out.add(mapped);
  }
  return Array.from(out).sort((a, b) => a - b);
}

/** v3 → v4: Promo ML passou a ficar à esquerda de Preço (trocam de posição nos índices 7 e 8). */
function swapPinnedPromoAndPriceColumnIndices(nums: number[]): number[] {
  const s = new Set(nums);
  const had7 = s.has(7);
  const had8 = s.has(8);
  if (had7) s.delete(7);
  if (had8) s.delete(8);
  if (had7) s.add(8);
  if (had8) s.add(7);
  return Array.from(s).sort((a, b) => a - b);
}

/** Migra índices da tabela com 20 colunas (havia coluna de unidades vendidas no índice 5). */
function migratePricingStickyV1ToV2(v1: number[]): Set<number> {
  const next = new Set<number>();
  const maxOld = 19;
  for (const c of v1) {
    if (typeof c !== "number" || !Number.isInteger(c) || c < 0 || c > maxOld) continue;
    if (c < 5) next.add(c);
    else if (c === 5) continue;
    else next.add(c - 1);
  }
  return next;
}

function readPrecosStickyInitial(): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(PRICOS_STICKY_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return new Set([0, 1, 2, 3, 4]);
      const n = PRICING_COLUMNS.length;
      const nums = arr.filter(
        (x): x is number =>
          typeof x === "number" && Number.isInteger(x) && x >= 0 && x < n
      );
      return new Set(nums);
    }
    const v5raw = localStorage.getItem(PRICOS_STICKY_V5_KEY);
    if (v5raw) {
      const arr = JSON.parse(v5raw) as unknown;
      if (Array.isArray(arr)) {
        const n = PRICING_COLUMNS.length;
        const nums = arr.filter(
          (x): x is number =>
            typeof x === "number" && Number.isInteger(x) && x >= 0 && x < n
        );
        const migrated = migrateStickyV5ToV6(nums).filter((x) => x >= 0 && x < n);
        const set = new Set(migrated);
        try {
          localStorage.setItem(
            PRICOS_STICKY_STORAGE_KEY,
            JSON.stringify(Array.from(set).sort((a, b) => a - b))
          );
          localStorage.removeItem(PRICOS_STICKY_V5_KEY);
        } catch {
          // ignore
        }
        return set;
      }
    }
    const v4raw = localStorage.getItem(PRICOS_STICKY_V4_KEY);
    if (v4raw) {
      const arr = JSON.parse(v4raw) as unknown;
      if (Array.isArray(arr)) {
        const n = PRICING_COLUMNS.length;
        const oldColCount = n - 1;
        const nums = arr.filter(
          (x): x is number =>
            typeof x === "number" && Number.isInteger(x) && x >= 0 && x < oldColCount
        );
        const migrated = migrateStickyV5ToV6(bumpStickyIndicesAfterPrecoFinalColumn(nums)).filter(
          (x) => x >= 0 && x < n
        );
        const set = new Set(migrated);
        try {
          localStorage.setItem(
            PRICOS_STICKY_STORAGE_KEY,
            JSON.stringify(Array.from(set).sort((a, b) => a - b))
          );
          localStorage.removeItem(PRICOS_STICKY_V4_KEY);
        } catch {
          // ignore
        }
        return set;
      }
    }
    const v3raw = localStorage.getItem(PRICOS_STICKY_V3_KEY);
    if (v3raw) {
      const arr = JSON.parse(v3raw) as unknown;
      if (Array.isArray(arr)) {
        const n = PRICING_COLUMNS.length;
        const nums = arr.filter(
          (x): x is number =>
            typeof x === "number" && Number.isInteger(x) && x >= 0 && x < n
        );
        const migrated = migrateStickyV5ToV6(swapPinnedPromoAndPriceColumnIndices(nums)).filter(
          (x) => x >= 0 && x < n
        );
        const set = new Set(migrated);
        try {
          localStorage.setItem(
            PRICOS_STICKY_STORAGE_KEY,
            JSON.stringify(Array.from(set).sort((a, b) => a - b))
          );
          localStorage.removeItem(PRICOS_STICKY_V3_KEY);
        } catch {
          // ignore
        }
        return set;
      }
    }
    const prevTable = localStorage.getItem(PRICOS_STICKY_PREV_TABLE_KEY);
    if (prevTable) {
      const arr = JSON.parse(prevTable) as unknown;
      if (Array.isArray(arr)) {
        const n = PRICING_COLUMNS.length;
        const nums = arr.filter(
          (x): x is number =>
            typeof x === "number" &&
            Number.isInteger(x) &&
            x >= 0 &&
            x < PRICING_TABLE_COL_COUNT_BEFORE_PROMO_ML
        );
        const migrated = migrateStickyV5ToV6(
          swapPinnedPromoAndPriceColumnIndices(bumpStickyIndicesAfterPromoMlColumn(nums))
        ).filter((x) => x >= 0 && x < n);
        const set = new Set(migrated);
        try {
          localStorage.setItem(
            PRICOS_STICKY_STORAGE_KEY,
            JSON.stringify(Array.from(set).sort((a, b) => a - b))
          );
          localStorage.removeItem(PRICOS_STICKY_PREV_TABLE_KEY);
        } catch {
          // ignore
        }
        return set;
      }
    }
    const legacy = localStorage.getItem(PRICOS_STICKY_LEGACY_KEY);
    if (legacy) {
      const arr = JSON.parse(legacy) as unknown;
      const migratedV2 =
        Array.isArray(arr) && arr.every((x) => typeof x === "number")
          ? migratePricingStickyV1ToV2(arr as number[])
          : new Set([0, 1, 2, 3, 4]);
      const withPromoCol = migrateStickyV5ToV6(
        swapPinnedPromoAndPriceColumnIndices(
          bumpStickyIndicesAfterPromoMlColumn(Array.from(migratedV2))
        )
      ).filter((x) => x >= 0 && x < PRICING_COLUMNS.length);
      const set = new Set(withPromoCol);
      try {
        localStorage.setItem(
          PRICOS_STICKY_STORAGE_KEY,
          JSON.stringify(Array.from(set).sort((a, b) => a - b))
        );
        localStorage.removeItem(PRICOS_STICKY_LEGACY_KEY);
      } catch {
        // ignore
      }
      return set;
    }
    return new Set([0, 1, 2, 3, 4]);
  } catch {
    return new Set([0, 1, 2, 3, 4]);
  }
}

function PriceInput({
  value,
  onChange,
  onCommit,
  dirty,
}: {
  value: number;
  onChange: (value: number) => void;
  onCommit: (committedPrice: number) => void;
  dirty?: boolean;
}) {
  const [localValue, setLocalValue] = useState(value.toFixed(2).replace(".", ","));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(value.toFixed(2).replace(".", ","));
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setLocalValue(raw);
    
    const cleaned = raw.replace(/[^\d,.-]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num >= 0) {
      onChange(num);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const cleaned = localValue.replace(/[^\d,.-]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    if (!isNaN(num) && num >= 0) {
      setLocalValue(num.toFixed(2).replace(".", ","));
      onChange(num);
      onCommit(num);
    } else {
      setLocalValue(value.toFixed(2).replace(".", ","));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <input
      type="text"
      value={localValue}
      onChange={handleChange}
      onFocus={() => setIsFocused(true)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className={`pricing-inline-input w-24 px-2 py-1 ${
        dirty ? "pricing-inline-input--dirty" : ""
      }`}
    />
  );
}

/** % margem líquida: (valor líquido − custo) / preço de venda — alinhado a getProfitPercent quando há calculated. */
function MarginInput({
  valuePercent,
  disabled,
  dirty,
  onCommit,
}: {
  valuePercent: number | null;
  disabled?: boolean;
  dirty?: boolean;
  onCommit: (pct: number) => void;
}) {
  const fmt = (v: number) => v.toFixed(1).replace(".", ",");
  const [localValue, setLocalValue] = useState(() => (valuePercent != null ? fmt(valuePercent) : ""));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      if (valuePercent != null) setLocalValue(fmt(valuePercent));
      else setLocalValue("");
    }
  }, [valuePercent, isFocused]);

  if (disabled) {
    return <span className="text-fg-muted text-sm">—</span>;
  }

  const handleBlur = () => {
    setIsFocused(false);
    const cleaned = localValue.replace(/[^\d,.-]/g, "").replace(",", ".");
    const num = parseFloat(cleaned);
    if (!isNaN(num)) {
      setLocalValue(fmt(num));
      onCommit(num);
    } else if (valuePercent != null) {
      setLocalValue(fmt(valuePercent));
    } else {
      setLocalValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className="flex items-center justify-end gap-0.5">
      <input
        type="text"
        inputMode="decimal"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        title="Margem líquida sobre o preço calculado. Ao confirmar, o preço calculado é ajustado pela calculadora (taxas ML, frete, impostos)."
        className={`pricing-inline-input w-[4.25rem] px-1.5 py-1 ${
          dirty ? "pricing-inline-input--dirty" : ""
        }`}
      />
      <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">%</span>
    </div>
  );
}

/** Resolve preço da promoção para margem líquida alvo: iteração com % salvo; refinamento listing_prices no servidor salvo se `skipRefine`. */
async function solveMarginViaApi(
  listing: ListingWithPricing,
  targetPct: number,
  isMercadoLider: boolean,
  options?: { skipRefine?: boolean }
): Promise<{ price: number; calculated: CalculatedPricing } | null> {
  if (
    !listing.listing_type_id ||
    !listing.category_id ||
    listing.cost_price == null ||
    !Number.isFinite(targetPct)
  ) {
    return null;
  }
  try {
    const res = await fetch("/api/pricing/solve-margin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: listing.item_id,
        variation_id: listing.variation_id,
        listing_type_id: listing.listing_type_id,
        category_id: listing.category_id,
        weight_kg: listing.weight_kg,
        height_cm: listing.height_cm,
        width_cm: listing.width_cm,
        length_cm: listing.length_cm,
        cost_price: listing.cost_price,
        tax_percent: listing.tax_percent,
        extra_fee_percent: listing.extra_fee_percent,
        fixed_expenses: listing.fixed_expenses,
        target_margin_percent: targetPct,
        is_mercado_lider: isMercadoLider,
        current_price: listing.current_price,
        planned_price: listing.new_price,
        seed_price: listing.new_price,
        reference_fee_percent: listing.reference_fee_percent ?? null,
        skip_refine: options?.skipRefine === true,
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      price?: number;
      calculated?: CalculatedPricing;
      error?: string;
    } | null;
    if (!res.ok || !data?.calculated || data.price == null || !Number.isFinite(Number(data.price))) {
      return null;
    }
    return { price: Number(data.price), calculated: data.calculated };
  } catch {
    return null;
  }
}

const MAX_PRICING_CALCULATE_BATCH = PRICING_CALCULATE_CLIENT_BATCH_SIZE;
const PLANNED_PRICES_SAVE_BATCH = 500;
/** Acima disso, não dispara cálculo automático ao carregar (use "Recalcular taxa e frete"). */
const AUTO_CALC_ON_LOAD_MAX = 200;

type PricingCalculatePayloadItem = {
  item_id: string;
  variation_id?: number | null;
  price: number;
  listing_type_id: string;
  category_id: string;
  weight_kg?: number | null;
  height_cm?: number | null;
  width_cm?: number | null;
  length_cm?: number | null;
  reference_fee_percent?: number | null;
};

type PricingCalculateResultRow = {
  item_id: string;
  variation_id: number | null;
  price: number;
  fee: number;
  shipping_cost: number;
};

function pricingResultKey(itemId: string, variationId: number | null | undefined): string {
  return `${itemId}:${variationId ?? "n"}`;
}

function buildPricingResultsMap(
  results: PricingCalculateResultRow[]
): Map<string, PricingCalculateResultRow> {
  const map = new Map<string, PricingCalculateResultRow>();
  for (const r of results) {
    map.set(pricingResultKey(r.item_id, r.variation_id), r);
  }
  return map;
}

function findPricingResultForListing(
  results: PricingCalculateResultRow[] | Map<string, PricingCalculateResultRow>,
  listing: Pick<ListingWithPricing, "item_id" | "variation_id">
): PricingCalculateResultRow | undefined {
  if (results instanceof Map) {
    return results.get(pricingResultKey(listing.item_id, listing.variation_id));
  }
  return results.find(
    (r) => r.item_id === listing.item_id && (r.variation_id ?? null) === (listing.variation_id ?? null)
  );
}

function applyCalculatedResultsToListings(
  prev: ListingWithPricing[],
  resultsMap: Map<string, PricingCalculateResultRow>,
  onlyKeys?: Set<string>
): ListingWithPricing[] {
  if (resultsMap.size === 0) return prev;
  return prev.map((listing) => {
    const key = listingSelectionKey(listing);
    if (onlyKeys && !onlyKeys.has(key)) return listing;
    const result = resultsMap.get(pricingResultKey(listing.item_id, listing.variation_id));
    if (!result) return listing;
    return {
      ...listing,
      calculated: computeFullPricingBreakdown(
        listing.tax_percent,
        listing.extra_fee_percent,
        listing.fixed_expenses,
        result
      ),
    };
  });
}

/** Chave única para checkbox / ações em massa (UUID do cache ou MLB + variação). */
function listingSelectionKey(l: Pick<PricingListing, "id" | "item_id" | "variation_id">): string {
  if (l.id) return l.id;
  return `${l.item_id}:${l.variation_id ?? "n"}`;
}

/** Margem em massa: lotes de até PRICING_CALCULATE_CLIENT_BATCH_SIZE por requisição (sem teto total). */
async function solveMarginBulkViaApi(
  items: ListingWithPricing[],
  targetPct: number,
  isMercadoLider: boolean
): Promise<{
  results: Array<{
    item_id: string;
    variation_id: number | null;
    price: number;
    calculated: CalculatedPricing;
  }>;
  errors: Array<{ item_id: string; variation_id: number | null; error: string }>;
}> {
  const payload = items
    .filter((l) => l.cost_price != null && l.listing_type_id && l.category_id)
    .map((l) => ({
      item_id: l.item_id,
      variation_id: l.variation_id,
      listing_type_id: l.listing_type_id!,
      category_id: l.category_id!,
      weight_kg: l.weight_kg,
      height_cm: l.height_cm,
      width_cm: l.width_cm,
      length_cm: l.length_cm,
      cost_price: l.cost_price!,
      tax_percent: l.tax_percent,
      extra_fee_percent: l.extra_fee_percent,
      fixed_expenses: l.fixed_expenses,
      reference_fee_percent: l.reference_fee_percent ?? null,
      current_price: l.current_price,
      planned_price: l.new_price,
    }));

  if (payload.length === 0) {
    return { results: [], errors: [] };
  }

  const results: Array<{
    item_id: string;
    variation_id: number | null;
    price: number;
    calculated: CalculatedPricing;
  }> = [];
  const errors: Array<{ item_id: string; variation_id: number | null; error: string }> = [];
  const step = PRICING_CALCULATE_CLIENT_BATCH_SIZE;

  for (let i = 0; i < payload.length; i += step) {
    const chunk = payload.slice(i, i + step);
    const res = await fetch("/api/pricing/solve-margin-bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_margin_percent: targetPct,
        is_mercado_lider: isMercadoLider,
        items: chunk,
      }),
    });

    const data = (await res.json().catch(() => null)) as {
      results?: Array<{
        item_id: string;
        variation_id: number | null;
        price: number;
        calculated: CalculatedPricing;
      }>;
      errors?: Array<{ item_id: string; variation_id: number | null; error: string }>;
      error?: string;
    } | null;

    if (!res.ok) {
      const msg = data?.error ?? `HTTP ${res.status}`;
      for (const p of chunk) {
        errors.push({
          item_id: p.item_id,
          variation_id: p.variation_id ?? null,
          error: msg,
        });
      }
      continue;
    }

    if (data?.results?.length) results.push(...data.results);
    if (data?.errors?.length) errors.push(...data.errors);
  }

  return { results, errors };
}

async function runConcurrentPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  onEachComplete?: () => void
): Promise<void> {
  if (items.length === 0) return;
  const n = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;
  const runner = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        await worker(items[i]);
      } finally {
        onEachComplete?.();
      }
    }
  };
  await Promise.all(Array.from({ length: n }, () => runner()));
}

/** Progresso em lote (desconto/restaurar ML): `flightEnd` = último índice do lote HTTP em curso. */
type BulkBatchLoaderProgress = {
  done: number;
  total: number;
  flightEnd?: number;
  phase?: "calculate" | "save";
  saveDone?: number;
  saveTotal?: number;
};

function bulkBatchLoaderMessage(p: BulkBatchLoaderProgress): string {
  if (p.phase === "save" && p.saveTotal != null && p.saveDone != null) {
    return `Gravando ${p.saveDone} de ${p.saveTotal} preço(s) no servidor…`;
  }
  const { done, total, flightEnd } = p;
  if (flightEnd != null && flightEnd > done && total > 0) {
    return `Processando ${done + 1} a ${flightEnd} de ${total} anúncios`;
  }
  return `Processando ${done} de ${total} anúncios`;
}

function bulkBatchLoaderDeterminatePercent(p: BulkBatchLoaderProgress): number {
  if (p.phase === "save" && p.saveTotal != null && p.saveDone != null && p.saveTotal > 0) {
    return Math.min(100, (p.saveDone / p.saveTotal) * 100);
  }
  const { done, total, flightEnd } = p;
  if (total <= 0) return 0;
  if (flightEnd != null && flightEnd > done) {
    const span = flightEnd - done;
    return Math.min(100, ((done + span * 0.35) / total) * 100);
  }
  return Math.min(100, (done / total) * 100);
}

/**
 * Envia o cálculo em lotes (PRICING_CALCULATE_CLIENT_BATCH_SIZE), em sequência, e concatena resultados.
 */
async function fetchPricingCalculateBatches(
  items: PricingCalculatePayloadItem[],
  isMercadoLider: boolean,
  onProgress?: (doneCount: number, totalCount: number, flightEnd?: number | null) => void,
  options?: { linearFees?: boolean }
): Promise<{
  results: PricingCalculateResultRow[];
  errors: { item_id: string; variation_id: number | null; error: string }[];
}> {
  const results: PricingCalculateResultRow[] = [];
  const errors: { item_id: string; variation_id: number | null; error: string }[] = [];
  const step = MAX_PRICING_CALCULATE_BATCH;
  if (!Number.isFinite(step) || step < 1) {
    throw new Error("PRICING_CALCULATE_CLIENT_BATCH_SIZE inválido");
  }
  const totalCount = items.length;
  let doneCount = 0;
  for (let i = 0; i < items.length; i += step) {
    const batch = items.slice(i, i + step);
    if (batch.length === 0) continue;
    const flightEnd = Math.min(doneCount + batch.length, totalCount);
    onProgress?.(doneCount, totalCount, flightEnd > doneCount ? flightEnd : null);
    try {
      const res = await fetch("/api/pricing/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: batch,
          is_mercado_lider: isMercadoLider,
          linear_fees: options?.linearFees === true,
        }),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errBody = (await res.json()) as { error?: string };
          if (errBody.error) detail = errBody.error;
        } catch {
          // ignore
        }
        for (const it of batch) {
          errors.push({
            item_id: it.item_id,
            variation_id: it.variation_id ?? null,
            error: detail,
          });
        }
        doneCount += batch.length;
        onProgress?.(doneCount, totalCount, null);
        continue;
      }
      const data = (await res.json()) as {
        results?: PricingCalculateResultRow[];
        errors?: { item_id: string; variation_id: number | null; error: string }[];
      };
      if (data.results?.length) results.push(...data.results);
      if (data.errors?.length) errors.push(...data.errors);
    } catch {
      for (const it of batch) {
        errors.push({
          item_id: it.item_id,
          variation_id: it.variation_id ?? null,
          error: "Falha de rede",
        });
      }
    }
    doneCount += batch.length;
    onProgress?.(doneCount, totalCount, null);
  }
  return { results, errors };
}

function PrecosPageContent() {
  const [listings, setListings] = useState<ListingWithPricing[]>([]);
  const listingsRef = useRef<ListingWithPricing[]>([]);
  /** Ignora respostas antigas de /api/pricing/listings (corrida ao trocar filtros rápido). */
  const listingsFetchGenRef = useRef(0);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  /** Recarrega lista com filtros novos sem bloquear a tela com o overlay (já há linhas na tela). */
  const [listingsRefetching, setListingsRefetching] = useState(false);
  const [search, setSearch] = useState("");
  const [skuFilter, setSkuFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [filterTagIds, setFilterTagIds] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<ProductTag[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  /** Filtro por vínculo com produto no cache */
  const [linkFilter, setLinkFilter] = useState<"all" | "linked" | "unlinked">("all");
  /** Somente anúncios Full (ml_items.is_fulfillment) */
  const [fullOnly, setFullOnly] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [isMercadoLider, setIsMercadoLider] = useState(false);
  /** Gold/Platinum na API de reputação — frete sempre incluído nos cálculos. */
  const [detectedMercadoLider, setDetectedMercadoLider] = useState(false);
  const [priceRounding, setPriceRounding] = useState<PriceRoundingConfig>(() =>
    readPriceRoundingPreference()
  );
  const [precosTab, setPrecosTab] = useState<"calculadora" | "como-funciona">("calculadora");
  const [saveMessage, setSaveMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  /** Filtro por lucratividade (%): condição + quantidade, no mesmo padrão de Vendidos. */
  const [profitOpFilter, setProfitOpFilter] = useState<StockCompareOp | "">("");
  const [profitQtyFilter, setProfitQtyFilter] = useState("");
  /** Quantidade vendida (soma das quantidades nos pedidos) últimos 30 dias por item_id */
  /** Número de pedidos (pagados) que contêm o item nos últimos 30 dias por item_id */
  const [ordersData, setOrdersData] = useState<Record<string, number>>({});
  /** Referências de preço ML por linha: `${ITEM}:${variação|item}` */
  const [priceRefsByRow, setPriceRefsByRow] = useState<Record<string, PriceReferenceCell>>({});
  const [mlAccountId, setMlAccountId] = useState<string>("");
  const [refJobId, setRefJobId] = useState<string | null>(null);
  const [refJob, setRefJob] = useState<{ status: string } | null>(null);
  const [salesError, setSalesError] = useState(false);
  const [cacheRefreshing, setCacheRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [cacheEmpty, setCacheEmpty] = useState(false);
  /** Há linhas com `product_id` em toda a conta (API); evita aviso “vincule” na página atual quando o filtro é só não vinculados. */
  const [accountHasLinkedProducts, setAccountHasLinkedProducts] = useState<boolean | null>(null);
  const [refreshingItemId, setRefreshingItemId] = useState<string | null>(null);
  /** Ordenação ativa na tabela */
  const [sortBy, setSortBy] = useState<
    "" | "orders_desc" | "orders_asc" | "cost_desc" | "cost_asc" | "profit_desc" | "profit_asc"
  >("");
  /** Filtro por vendas 30d (pedidos pagos): condição + quantidade. */
  const [sales30dOpFilter, setSales30dOpFilter] = useState<StockCompareOp | "">("");
  const [sales30dQtyFilter, setSales30dQtyFilter] = useState("");
  /** Filtro por custo (R$): condição + quantidade. */
  const [costOpFilter, setCostOpFilter] = useState<StockCompareOp | "">("");
  const [costQtyFilter, setCostQtyFilter] = useState("");
  /** Desconto % (preço ML → promoção): condição + valor, filtro no cliente */
  const [discountOpFilter, setDiscountOpFilter] = useState<StockCompareOp | "">("");
  const [discountQtyFilter, setDiscountQtyFilter] = useState("");
  /** Sem campanhas/promoções ativas no ML (seller-promotions) no último refresh do cache */
  const [semPromoMlAtiva, setSemPromoMlAtiva] = useState(false);
  /** PMA cadastrado no produto vinculado */
  const [hasPmaFilter, setHasPmaFilter] = useState<ProductHasPmaFilter>("");
  /** Com filtros no cliente: carregar até 2000 itens de uma vez (em vez de 500) */
  /** Itens selecionados para criar campanha ML (por id de listing) */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  /** Célula copiada (ex: "mlb-id" ou "sku-id") para mostrar "Copiado!" como na tela de anúncios */
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [campaignStart, setCampaignStart] = useState("");
  const [campaignFinish, setCampaignFinish] = useState("");
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignMessage, setCampaignMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  /** Itens com erro ou sem preço salvo após criar campanha (para CSV). */
  const [campaignIssuesForDownload, setCampaignIssuesForDownload] = useState<SellerCampaignItemResult[] | null>(null);
  const [updatePriceOpen, setUpdatePriceOpen] = useState(false);
  const [updatePriceLoading, setUpdatePriceLoading] = useState(false);
  const [updatePriceMessage, setUpdatePriceMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [updatePriceResult, setUpdatePriceResult] = useState<UpdatePriceModalResult | null>(null);
  /** Índices das colunas congeladas (0-based). Ordem dos congelados = ordem na tabela. Persistido em localStorage após hidratação. */
  const [stickyColumns, setStickyColumns] = useState<Set<number>>(() => new Set());
  const [stickyHydrated, setStickyHydrated] = useState(false);
  /** Menu ▾ no cabeçalho da coluna (congelar / ordenar vendas), padrão Anúncios */
  const [headerMenuColumn, setHeaderMenuColumn] = useState<number | null>(null);
  /** Menu suspenso de ações em massa (linhas selecionadas) */
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false);
  const bulkActionsRef = useRef<HTMLDivElement | null>(null);
  /** Menu Atualizar dados / competitividade / Recalcular taxa e frete */
  const [globalActionsOpen, setGlobalActionsOpen] = useState(false);
  const globalActionsRef = useRef<HTMLDivElement | null>(null);
  const bulkDiscountBusyRef = useRef(false);
  const [bulkDiscountModalOpen, setBulkDiscountModalOpen] = useState(false);
  const [bulkDiscountPercentInput, setBulkDiscountPercentInput] = useState(String(ML_MIN_CAMPAIGN_DISCOUNT_PERCENT));
  /** Modal: definir margem líquida (%) nos anúncios selecionados */
  const [bulkMarginModalOpen, setBulkMarginModalOpen] = useState(false);
  const [bulkMarginPercentInput, setBulkMarginPercentInput] = useState("");
  const bulkMarginBusyRef = useRef(false);
  /** Progresso no overlay durante "Definir margem líquida" em massa (ex.: "Processando 12 de 40 anúncios"). */
  const [bulkMarginLoaderProgress, setBulkMarginLoaderProgress] = useState<BulkBatchLoaderProgress | null>(
    null
  );
  /** Progresso no overlay durante desconto em massa (recalcular via /api/pricing/calculate em lotes). */
  const [bulkDiscountLoaderProgress, setBulkDiscountLoaderProgress] = useState<BulkBatchLoaderProgress | null>(
    null
  );
  /** Progresso no overlay ao restaurar promoção = preço ML em massa. */
  const [bulkRestoreLoaderProgress, setBulkRestoreLoaderProgress] = useState<BulkBatchLoaderProgress | null>(null);
  const bulkRestoreOriginalBusyRef = useRef(false);
  const campaignMessageDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const precosImportFileInputRef = useRef<HTMLInputElement>(null);
  const [precosImportCsvModalOpen, setPrecosImportCsvModalOpen] = useState(false);
  const [precosImportLoading, setPrecosImportLoading] = useState(false);
  const [precosImportConfirming, setPrecosImportConfirming] = useState(false);
  /** Overlay: leitura do CSV (parse) ou gravação em lotes (confirm). */
  const [precosImportLoaderProgress, setPrecosImportLoaderProgress] = useState<{
    done: number;
    total: number;
    stage: "parse" | "confirm";
  } | null>(null);
  const [precosImportResult, setPrecosImportResult] = useState<{
    ok?: boolean;
    total_rows: number;
    valid_rows: number;
    error_rows: number;
    errors_truncated?: boolean;
    errors?: Array<{ row: number; field?: string; message: string }>;
    preview: PrecosImportPreviewRow[];
    valid_items?: PrecosImportRowValid[];
  } | null>(null);

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

  const loadReputation = useCallback(async () => {
    try {
      const res = await fetch("/api/mercadolivre/reputation");
      if (res.ok) {
        const data = (await res.json()) as ReputationData;
        const detected = isMercadoLiderPowerSeller(data.reputation?.power_seller_status);
        setDetectedMercadoLider(detected);
        setIsMercadoLider(effectiveCalcularFreteMl(detected));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const syncFretePreference = () => {
      if (!detectedMercadoLider) {
        setIsMercadoLider(readCalcularFretePreference());
      }
    };
    window.addEventListener(PRICING_FRETE_PREFERENCE_EVENT, syncFretePreference);
    return () => window.removeEventListener(PRICING_FRETE_PREFERENCE_EVENT, syncFretePreference);
  }, [detectedMercadoLider]);

  useEffect(() => {
    void loadPriceRoundingPreference().then(setPriceRounding);
  }, []);

  useEffect(() => {
    const syncRounding = () => {
      void loadPriceRoundingPreference().then(setPriceRounding);
    };
    window.addEventListener(PRICING_ROUNDING_PREFERENCE_EVENT, syncRounding);
    return () => window.removeEventListener(PRICING_ROUNDING_PREFERENCE_EVENT, syncRounding);
  }, []);

  const pageForRequest = apiListPage(pageSize, page);
  const limitForRequest = isAllPageSize(pageSize) ? 0 : pageSize;

  const loadListings = useCallback(async () => {
    const fetchGen = ++listingsFetchGenRef.current;
    const isRefetch = listingsRef.current.length > 0;
    if (isRefetch) setListingsRefetching(true);
    else setLoading(true);
    const params = new URLSearchParams({
      page: String(pageForRequest),
      limit: String(limitForRequest),
    });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (linkFilter === "linked") params.set("linked", "1");
    if (linkFilter === "unlinked") params.set("linked", "0");
    if (
      sortBy === "orders_desc" ||
      sortBy === "orders_asc" ||
      sortBy === "cost_desc" ||
      sortBy === "cost_asc" ||
      sortBy === "profit_desc" ||
      sortBy === "profit_asc"
    ) {
      params.set("order_by", sortBy);
    }
    if (skuFilter) params.set("sku", skuFilter);
    if (supplierFilter) params.set("supplier", supplierFilter);
    if (filterTagIds.length > 0) params.set("tags", filterTagIds.join(","));
    if (fullOnly) params.set("full_only", "1");
    if (sales30dOpFilter && sales30dQtyFilter.trim()) {
      params.set("orders_30d_op", sales30dOpFilter);
      params.set("orders_30d_qty", sales30dQtyFilter.trim());
    }
    if (costOpFilter && costQtyFilter.trim()) {
      params.set("cost_op", costOpFilter);
      params.set("cost_qty", costQtyFilter.trim());
    }
    if (discountOpFilter && discountQtyFilter.trim()) {
      params.set("discount_op", discountOpFilter);
      params.set("discount_qty", discountQtyFilter.trim());
    }
    if (profitOpFilter && profitQtyFilter.trim()) {
      params.set("profit_op", profitOpFilter);
      params.set("profit_qty", profitQtyFilter.trim());
    }
    if (semPromoMlAtiva) params.set("sem_promo_ml", "1");
    if (hasPmaFilter) params.set("has_pma", hasPmaFilter);

    try {
      const loadAllRows = isAllPageSize(limitForRequest);
      const listingsPromise = fetch(`/api/pricing/listings?${params}`, { cache: "no-store" });
      const plannedPromise = loadAllRows
        ? null
        : fetch("/api/pricing/planned-prices", { cache: "no-store" });
      const [listingsRes, plannedRes] = await Promise.all([
        listingsPromise,
        plannedPromise ?? Promise.resolve(null),
      ]);

      if (fetchGen !== listingsFetchGenRef.current) return;

      const listingsData = listingsRes.ok ? await listingsRes.json() : { listings: [], total: 0 };
      const items = (listingsData.listings ?? []) as PricingListing[];
      if (listingsData.orders && typeof listingsData.orders === "object") {
        setOrdersData(listingsData.orders as Record<string, number>);
      }
      if (listingsData.price_references && typeof listingsData.price_references === "object") {
        setPriceRefsByRow(listingsData.price_references as Record<string, PriceReferenceCell>);
      } else {
        setPriceRefsByRow({});
      }
      if (typeof (listingsData as { account_id?: string }).account_id === "string") {
        setMlAccountId((listingsData as { account_id: string }).account_id);
      }
      const plannedMap = new Map<string, number>();
      if (plannedRes?.ok) {
        const plannedData = await plannedRes.json();
        const plannedList = plannedData.prices ?? [];
        for (const p of plannedList) {
          const key = `${p.item_id}:${p.variation_id ?? "n"}`;
          plannedMap.set(key, p.planned_price);
        }
      }

      if (fetchGen !== listingsFetchGenRef.current) return;

      setListings(
        items.map((item) => {
          const key = `${item.item_id}:${item.variation_id ?? "n"}`;
          const apiItem = item as PricingListing & {
            planned_price?: number;
            calculated_price?: number | null;
            calculated_fee?: number | null;
            calculated_shipping_cost?: number | null;
            calculated_at?: string | null;
          };
          const fromApi = apiItem.planned_price;
          const savedPrice = plannedMap.get(key);
          const newPrice = fromApi ?? savedPrice ?? item.current_price;
          let calculated: CalculatedPricing | undefined;
          if (
            apiItem.calculated_price != null &&
            apiItem.calculated_fee != null &&
            apiItem.calculated_shipping_cost != null
          ) {
            const cp = Number(apiItem.calculated_price);
            /** Taxa/frete do cache são do último cálculo nesse preço; se planned mudou e calculated_* não foi atualizado, não misturar com a promoção atual. */
            if (Number.isFinite(cp) && Math.abs(cp - newPrice) < 0.02) {
              calculated = computeFullPricingBreakdown(item.tax_percent, item.extra_fee_percent, item.fixed_expenses, {
                price: cp,
                fee: apiItem.calculated_fee,
                shipping_cost: apiItem.calculated_shipping_cost,
              });
            }
          }
          return {
            ...item,
            new_price: newPrice,
            dirty: false,
            calculated,
          };
        })
      );
      setTotal(listingsData.total ?? 0);
      setLastUpdatedAt((listingsData as { last_updated_at?: string | null }).last_updated_at ?? null);
      setCacheEmpty((listingsData as { cache_empty?: boolean }).cache_empty ?? false);
      const rawLinked = (listingsData as { account_has_linked_products?: boolean }).account_has_linked_products;
      setAccountHasLinkedProducts(
        typeof rawLinked === "boolean" ? rawLinked : items.some((i) => Boolean(i.product_id))
      );
    } catch {
      // ignore
    } finally {
      if (fetchGen === listingsFetchGenRef.current) {
        setLoading(false);
        setListingsRefetching(false);
      }
    }
  }, [
    pageForRequest,
    limitForRequest,
    search,
    statusFilter,
    linkFilter,
    fullOnly,
    sortBy,
    skuFilter,
    supplierFilter,
    filterTagIds,
    sales30dOpFilter,
    sales30dQtyFilter,
    costOpFilter,
    costQtyFilter,
    discountOpFilter,
    discountQtyFilter,
    profitOpFilter,
    profitQtyFilter,
    semPromoMlAtiva,
    hasPmaFilter,
  ]);

  const fetchRefJob = useCallback(
    async (jobId: string) => {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) return;
      const data = await res.json();
      setRefJob({ status: data.job?.status ?? "unknown" });
      if (["success", "failed", "partial"].includes(data.job?.status ?? "")) {
        setRefJobId(null);
        await loadListings();
      }
    },
    [loadListings]
  );

  useEffect(() => {
    if (!refJobId) return;
    void fetchRefJob(refJobId);
    const interval = setInterval(() => void fetchRefJob(refJobId), 2500);
    return () => clearInterval(interval);
  }, [refJobId, fetchRefJob]);

  const handleRefreshPriceReferences = useCallback(async () => {
    const accountId = mlAccountId || listings[0]?.account_id;
    if (!accountId) return;
    try {
      const res = await fetch("/api/price-references/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, scope: "all" }),
      });
      const data = (await res.json().catch(() => ({}))) as { job_id?: string; error?: string };
      if (res.ok && data.job_id) {
        setRefJobId(data.job_id);
        setRefJob({ status: "queued" });
        return;
      }
      setSaveMessage({
        type: "error",
        text: data.error ?? "Não foi possível iniciar a atualização da competitividade.",
      });
    } catch {
      setSaveMessage({
        type: "error",
        text: "Erro de conexão ao atualizar competitividade.",
      });
    }
  }, [mlAccountId, listings]);

  const handleRefreshCache = useCallback(async () => {
    setCacheRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/pricing/cache/refresh", { method: "POST" });
      const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { error?: string }).error ?? "Falha ao atualizar o cache";
        console.error("[precos] Refresh cache falhou:", res.status, data);
        setRefreshError(msg);
      }
      await loadListings();
    } catch (err) {
      setRefreshError("Erro de conexão ao atualizar. Tente novamente.");
      await loadListings();
    } finally {
      setCacheRefreshing(false);
    }
  }, [loadListings]);

  const handleRefreshItem = useCallback(
    async (itemId: string) => {
      setRefreshingItemId(itemId);
      try {
        const res = await fetch("/api/pricing/cache/refresh-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_id: itemId }),
        });
        if (res.ok) await loadListings();
      } finally {
        setRefreshingItemId(null);
      }
    },
    [loadListings]
  );

  useEffect(() => {
    loadReputation();
  }, [loadReputation]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadListings();
      if (cancelled) return;
      /** Produtos/importação podem marcar stale: 2º GET alinha custos/vínculos após refresh do cache no servidor. */
      if (consumePricingListingsStaleFlag()) {
        await loadListings();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadListings]);

  /** Recarrega quando Produtos avisa (mesma aba, outra aba ou ao voltar o foco). */
  useEffect(() => subscribePricingListingsRefresh(() => void loadListings()), [loadListings]);

  useEffect(() => {
    setPage(1);
  }, [profitOpFilter, sales30dOpFilter, costOpFilter, discountOpFilter, semPromoMlAtiva, hasPmaFilter]);

  /** Dados sempre vêm do cache (listings já inclui orders_30d). Não busca vendas em separado. */

  const doCalculate = useCallback(
    async (items: ListingWithPricing[], mercadoLider: boolean) => {
      const eligible = items.filter(
        (item) => item.new_price > 0 && item.listing_type_id && item.category_id
      );
      if (eligible.length === 0) return;

      const allHaveRefFee = eligible.every(
        (item) =>
          item.reference_fee_percent != null &&
          Number.isFinite(Number(item.reference_fee_percent)) &&
          Number(item.reference_fee_percent) >= 0
      );

      const itemsToCalculate = eligible.map((item) => ({
        item_id: item.item_id,
        variation_id: item.variation_id,
        price: item.new_price,
        listing_type_id: item.listing_type_id!,
        category_id: item.category_id!,
        weight_kg: item.weight_kg,
        height_cm: item.height_cm,
        width_cm: item.width_cm,
        length_cm: item.length_cm,
        reference_fee_percent: item.reference_fee_percent ?? null,
      }));

      try {
        const { results } = await fetchPricingCalculateBatches(itemsToCalculate, mercadoLider, undefined, {
          linearFees: allHaveRefFee,
        });
        const resultsMap = buildPricingResultsMap(results);
        setListings((prev) => applyCalculatedResultsToListings(prev, resultsMap));
      } catch {
        // ignore
      }
    },
    []
  );

  // Auto-calculate when listings are loaded (only once per load)
  const lastCalculatedKey = useRef<string>("");

  useEffect(() => {
    listingsRef.current = listings;
  }, [listings]);
  
  useEffect(() => {
    if (!loading && listings.length > 0 && !calculating) {
      const key = `${pageSize}-${page}-${search}-${statusFilter}-${linkFilter}-${skuFilter}`;
      if (lastCalculatedKey.current !== key) {
        const skipAutoCalc =
          isAllPageSize(pageSize) || listings.length > AUTO_CALC_ON_LOAD_MAX;
        const hasUncalculated = listings.some((l) => !l.calculated && l.listing_type_id);
        if (skipAutoCalc) {
          if (hasUncalculated) lastCalculatedKey.current = key;
          return;
        }
        if (hasUncalculated) {
          lastCalculatedKey.current = key;
          setCalculating(true);
          const itemsToCalc = [...listings];
          doCalculate(itemsToCalc, isMercadoLider).finally(() => setCalculating(false));
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, listings.length, calculating, pageSize, page, search, statusFilter, linkFilter, skuFilter]);

  const calculatePrices = useCallback(
    async (items: ListingWithPricing[]) => {
      if (items.length === 0) return;

      setCalculating(true);

      const itemsToCalculate = items
        .filter((item) => item.new_price > 0 && item.listing_type_id && item.category_id)
        .map((item) => ({
          item_id: item.item_id,
          variation_id: item.variation_id,
          price: item.new_price,
          listing_type_id: item.listing_type_id!,
          category_id: item.category_id!,
          weight_kg: item.weight_kg,
          height_cm: item.height_cm,
          width_cm: item.width_cm,
          length_cm: item.length_cm,
          reference_fee_percent: item.reference_fee_percent ?? null,
        }));

      if (itemsToCalculate.length === 0) {
        setCalculating(false);
        return;
      }

      try {
        const { results } = await fetchPricingCalculateBatches(itemsToCalculate, isMercadoLider);
        const resultsMap = buildPricingResultsMap(results);
        setListings((prev) => applyCalculatedResultsToListings(prev, resultsMap));
      } catch {
        // ignore
      } finally {
        setCalculating(false);
      }
    },
    [isMercadoLider]
  );

  const buildListingsFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (linkFilter === "linked") params.set("linked", "1");
    if (linkFilter === "unlinked") params.set("linked", "0");
    if (
      sortBy === "orders_desc" ||
      sortBy === "orders_asc" ||
      sortBy === "cost_desc" ||
      sortBy === "cost_asc" ||
      sortBy === "profit_desc" ||
      sortBy === "profit_asc"
    ) {
      params.set("order_by", sortBy);
    }
    if (skuFilter) params.set("sku", skuFilter);
    if (supplierFilter) params.set("supplier", supplierFilter);
    if (filterTagIds.length > 0) params.set("tags", filterTagIds.join(","));
    if (fullOnly) params.set("full_only", "1");
    if (sales30dOpFilter && sales30dQtyFilter.trim()) {
      params.set("orders_30d_op", sales30dOpFilter);
      params.set("orders_30d_qty", sales30dQtyFilter.trim());
    }
    if (costOpFilter && costQtyFilter.trim()) {
      params.set("cost_op", costOpFilter);
      params.set("cost_qty", costQtyFilter.trim());
    }
    if (discountOpFilter && discountQtyFilter.trim()) {
      params.set("discount_op", discountOpFilter);
      params.set("discount_qty", discountQtyFilter.trim());
    }
    if (profitOpFilter && profitQtyFilter.trim()) {
      params.set("profit_op", profitOpFilter);
      params.set("profit_qty", profitQtyFilter.trim());
    }
    if (semPromoMlAtiva) params.set("sem_promo_ml", "1");
    if (hasPmaFilter) params.set("has_pma", hasPmaFilter);
    return params;
  }, [
    search,
    statusFilter,
    linkFilter,
    sortBy,
    skuFilter,
    supplierFilter,
    filterTagIds,
    fullOnly,
    sales30dOpFilter,
    sales30dQtyFilter,
    costOpFilter,
    costQtyFilter,
    discountOpFilter,
    discountQtyFilter,
    profitOpFilter,
    profitQtyFilter,
    semPromoMlAtiva,
    hasPmaFilter,
  ]);

  const handleCalculateAll = useCallback(async () => {
    const catalogWide = total > listings.length;
    setCalculating(true);
    setSaveMessage(null);
    try {
      if (catalogWide) {
        const params = buildListingsFilterParams();
        const res = await fetch(`/api/pricing/recalculate-fees?${params}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_mercado_lider: isMercadoLider }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          processed?: number;
          eligible?: number;
          total_in_cache?: number;
          errors_count?: number;
          skipped?: number;
        };
        if (!res.ok) {
          setSaveMessage({
            type: "error",
            text: data.error ?? "Erro ao recalcular taxa e frete no catálogo filtrado.",
          });
          setTimeout(() => setSaveMessage(null), 8000);
          return;
        }
        const processed = data.processed ?? 0;
        const eligible = data.eligible ?? data.total_in_cache ?? total;
        let msg = `Taxa e frete recalculados para ${processed} de ${eligible} anúncio(s) do filtro atual.`;
        if ((data.errors_count ?? 0) > 0) msg += ` ${data.errors_count} aviso(s).`;
        if ((data.skipped ?? 0) > 0) msg += ` ${data.skipped} ignorado(s) (sem preço ou dados ML).`;
        setSaveMessage({ type: processed > 0 ? "ok" : "error", text: msg });
        setTimeout(() => setSaveMessage(null), 10000);
        await loadListings();
      } else {
        await calculatePrices(listings);
      }
    } catch {
      setSaveMessage({ type: "error", text: "Erro de conexão ao recalcular taxa e frete." });
      setTimeout(() => setSaveMessage(null), 6000);
    } finally {
      setCalculating(false);
    }
  }, [
    total,
    listings,
    buildListingsFilterParams,
    isMercadoLider,
    calculatePrices,
    loadListings,
  ]);

  const persistPlannedPrices = useCallback(
    async (
      items: Array<{ item_id: string; variation_id: number | null; sku?: string; planned_price: number }>,
      opts?: { quietSuccess?: boolean; onSaveProgress?: (done: number, total: number) => void }
    ): Promise<{ ok: boolean; saved: number; error?: string }> => {
      const toSave = items.filter((x) => Number.isFinite(x.planned_price) && x.planned_price >= 0);
      if (toSave.length === 0) return { ok: true, saved: 0 };

      if (!opts?.quietSuccess) setSaveMessage(null);

      const clearDirtyForBatch = (batch: typeof toSave) => {
        const savedKeys = new Set(batch.map((l) => `${l.item_id}:${l.variation_id ?? "n"}`));
        setListings((prev) =>
          prev.map((item) => {
            const key = `${item.item_id}:${item.variation_id ?? "n"}`;
            return savedKeys.has(key) ? { ...item, dirty: false } : item;
          })
        );
      };

      let totalSaved = 0;
      try {
        for (let i = 0; i < toSave.length; i += PLANNED_PRICES_SAVE_BATCH) {
          const batch = toSave.slice(i, i + PLANNED_PRICES_SAVE_BATCH);
          const res = await fetch("/api/pricing/planned-prices", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: batch.map((l) => ({
                item_id: l.item_id,
                variation_id: l.variation_id,
                sku: l.sku,
                planned_price: l.planned_price,
              })),
            }),
          });
          const data = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({}));
          if (!res.ok) {
            const err = (data as { error?: string }).error ?? "Erro ao salvar";
            setSaveMessage({ type: "error", text: err });
            return { ok: false, saved: totalSaved, error: err };
          }
          const saved = (data as { saved?: number }).saved ?? batch.length;
          totalSaved += saved;
          clearDirtyForBatch(batch);
          opts?.onSaveProgress?.(Math.min(i + batch.length, toSave.length), toSave.length);
        }
        if (!opts?.quietSuccess) {
          setSaveMessage({ type: "ok", text: `${totalSaved} preço(s) salvos (MLB + SKU).` });
          setTimeout(() => setSaveMessage(null), 4000);
        }
        return { ok: true, saved: totalSaved };
      } catch {
        setSaveMessage({ type: "error", text: "Erro ao salvar preços" });
        return { ok: false, saved: totalSaved, error: "Erro ao salvar preços" };
      }
    },
    []
  );

  const handlePriceChange = useCallback((id: string, variationId: number | null, value: string) => {
    const numValue = parseFloat(value.replace(",", ".")) || 0;
    setListings((prev) =>
      prev.map((item) => {
        if (item.id === id && item.variation_id === variationId) {
          return { ...item, new_price: numValue, dirty: true };
        }
        return item;
      })
    );
  }, []);

  const handleCalculateSingle = useCallback(
    async (listing: ListingWithPricing, opts?: { price?: number }) => {
      const price = opts?.price ?? listing.new_price;
      if (!listing.listing_type_id || !listing.category_id || price <= 0) return;

      setListings((prev) =>
        prev.map((item) =>
          item.id === listing.id ? { ...item, calculating: true } : item
        )
      );

      try {
        const res = await fetch("/api/pricing/calculate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              {
                item_id: listing.item_id,
                variation_id: listing.variation_id,
                price,
                listing_type_id: listing.listing_type_id,
                category_id: listing.category_id,
                weight_kg: listing.weight_kg,
                height_cm: listing.height_cm,
                width_cm: listing.width_cm,
                length_cm: listing.length_cm,
              },
            ],
            is_mercado_lider: isMercadoLider,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const result = data.results?.[0] as { price: number; fee: number; shipping_cost: number } | undefined;
          if (result) {
            const listingForCalc = { ...listing, new_price: price };
            setListings((prev) =>
              prev.map((item) =>
                item.id === listing.id
                  ? {
                      ...item,
                      calculated: computeFullPricingBreakdown(
                        listingForCalc.tax_percent,
                        listingForCalc.extra_fee_percent,
                        listingForCalc.fixed_expenses,
                        result
                      ),
                      calculating: false,
                    }
                  : item
              )
            );
          } else {
            setListings((prev) =>
              prev.map((item) =>
                item.id === listing.id ? { ...item, calculating: false } : item
              )
            );
          }
        } else {
          setListings((prev) =>
            prev.map((item) =>
              item.id === listing.id ? { ...item, calculating: false } : item
            )
          );
        }
      } catch {
        setListings((prev) =>
          prev.map((item) =>
            item.id === listing.id ? { ...item, calculating: false } : item
          )
        );
      }
    },
    [isMercadoLider]
  );

  const handlePriceRowCommit = useCallback(
    async (listing: ListingWithPricing, committedPrice: number) => {
      const { price: finalPrice, clamped, pmaFloor } = clampPromoPriceToPmaFloor(
        committedPrice,
        listing.pma
      );
      if (clamped && pmaFloor != null) {
        setSaveMessage({ type: "ok", text: formatPmaClampSingleMessage(listing, pmaFloor) });
        setTimeout(() => setSaveMessage(null), 6000);
      }
      setListings((prev) =>
        prev.map((item) =>
          item.id === listing.id && item.variation_id === listing.variation_id
            ? { ...item, new_price: finalPrice, dirty: true }
            : item
        )
      );
      await handleCalculateSingle({ ...listing, new_price: finalPrice }, { price: finalPrice });
      await persistPlannedPrices(
        [
          {
            item_id: listing.item_id,
            variation_id: listing.variation_id,
            sku: listing.sku ?? undefined,
            planned_price: finalPrice,
          },
        ],
        { quietSuccess: true }
      );
    },
    [handleCalculateSingle, persistPlannedPrices]
  );

  const handleMarginCommit = useCallback(
    async (listing: ListingWithPricing, targetPct: number) => {
      if (
        listing.cost_price == null ||
        !listing.listing_type_id ||
        !listing.category_id
      ) {
        setSaveMessage({
          type: "error",
          text: "Para ajustar pela margem é necessário custo cadastrado e tipo de anúncio (sincronize os anúncios se faltar).",
        });
        setTimeout(() => setSaveMessage(null), 6000);
        return;
      }

      setListings((prev) =>
        prev.map((item) =>
          item.id === listing.id && item.variation_id === listing.variation_id
            ? { ...item, calculating: true }
            : item
        )
      );

      try {
        const solved = await solveMarginViaApi(listing, targetPct, isMercadoLider);
        if (!solved) {
          setSaveMessage({
            type: "error",
            text: "Não foi possível encontrar um preço para essa margem. Tente outro valor ou ajuste o preço manualmente.",
          });
          setTimeout(() => setSaveMessage(null), 6000);
          setListings((prev) =>
            prev.map((item) =>
              item.id === listing.id && item.variation_id === listing.variation_id
                ? { ...item, calculating: false }
                : item
            )
          );
          return;
        }

        const p = Math.round(solved.price * 100) / 100;
        const { price: finalPrice, clamped, pmaFloor } = clampPromoPriceToPmaFloor(p, listing.pma);
        if (clamped && pmaFloor != null) {
          setSaveMessage({ type: "ok", text: formatPmaClampSingleMessage(listing, pmaFloor) });
          setTimeout(() => setSaveMessage(null), 6000);
        }

        setListings((prev) =>
          prev.map((item) =>
            item.id === listing.id && item.variation_id === listing.variation_id
              ? {
                  ...item,
                  new_price: finalPrice,
                  dirty: true,
                  calculated: clamped ? undefined : solved.calculated,
                  calculating: false,
                }
              : item
          )
        );
        if (clamped) {
          await handleCalculateSingle({ ...listing, new_price: finalPrice }, { price: finalPrice });
        }
        await persistPlannedPrices(
          [
            {
              item_id: listing.item_id,
              variation_id: listing.variation_id,
              sku: listing.sku ?? undefined,
              planned_price: finalPrice,
            },
          ],
          { quietSuccess: true }
        );
      } catch {
        setListings((prev) =>
          prev.map((item) =>
            item.id === listing.id && item.variation_id === listing.variation_id
              ? { ...item, calculating: false }
              : item
          )
        );
        setSaveMessage({
          type: "error",
          text: "Erro ao calcular preço pela margem.",
        });
        setTimeout(() => setSaveMessage(null), 5000);
      }
    },
    [isMercadoLider, persistPlannedPrices, handleCalculateSingle]
  );
  const handleApplyMinDiscount = useCallback(
    async (listing: ListingWithPricing) => {
      let newPrice = Math.floor(listing.current_price * 0.95 * 100) / 100;
      const { price: finalPrice, clamped: pmaClamped, pmaFloor } = clampPromoPriceToPmaFloor(
        newPrice,
        listing.pma
      );
      newPrice = finalPrice;
      try {
        setListings((prev) =>
          prev.map((item) =>
            item.id === listing.id && item.variation_id === listing.variation_id
              ? { ...item, new_price: newPrice, dirty: true, calculating: true }
              : item
          )
        );
        try {
          const res = await fetch("/api/pricing/calculate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [
                {
                  item_id: listing.item_id,
                  variation_id: listing.variation_id,
                  price: newPrice,
                  listing_type_id: listing.listing_type_id,
                  category_id: listing.category_id,
                  weight_kg: listing.weight_kg,
                  height_cm: listing.height_cm,
                  width_cm: listing.width_cm,
                  length_cm: listing.length_cm,
                },
              ],
              is_mercado_lider: isMercadoLider,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const result = data.results?.[0] as { price: number; fee: number; shipping_cost: number } | undefined;
            if (result) {
              const listingWithNewPrice = { ...listing, new_price: newPrice };
              setListings((prev) =>
                prev.map((item) =>
                  item.id === listing.id && item.variation_id === listing.variation_id
                    ? {
                        ...item,
                        new_price: newPrice,
                        dirty: true,
                        calculated: computeFullPricingBreakdown(
                          listingWithNewPrice.tax_percent,
                          listingWithNewPrice.extra_fee_percent,
                          listingWithNewPrice.fixed_expenses,
                          result
                        ),
                        calculating: false,
                      }
                    : item
                )
              );
            } else {
              setListings((prev) =>
                prev.map((item) =>
                  item.id === listing.id && item.variation_id === listing.variation_id
                    ? { ...item, new_price: newPrice, dirty: true, calculating: false }
                    : item
                )
              );
            }
          } else {
            setListings((prev) =>
              prev.map((item) =>
                item.id === listing.id && item.variation_id === listing.variation_id
                  ? { ...item, new_price: newPrice, dirty: true, calculating: false }
                  : item
              )
            );
          }
        } catch {
          setListings((prev) =>
            prev.map((item) =>
              item.id === listing.id && item.variation_id === listing.variation_id
                ? { ...item, new_price: newPrice, dirty: true, calculating: false }
                : item
            )
          );
        }
      } finally {
        const pres = await persistPlannedPrices(
          [
            {
              item_id: listing.item_id,
              variation_id: listing.variation_id,
              sku: listing.sku ?? undefined,
              planned_price: newPrice,
            },
          ],
          { quietSuccess: true }
        );
        if (pres.ok) {
          let text = "Preço calculado ajustado ao mínimo de 5% (promo ML) e salvo automaticamente.";
          if (pmaClamped && pmaFloor != null) {
            text = `${formatPmaClampSingleMessage(listing, pmaFloor)} Salvo automaticamente.`;
          }
          setSaveMessage({ type: "ok", text });
          setTimeout(() => setSaveMessage(null), 5000);
        }
      }
    },
    [isMercadoLider, persistPlannedPrices]
  );

  /** Define desconto de promoção (%) nos selecionados, com recálculo em lote. */
  const handleBulkApplyDiscountPercent = useCallback(async (): Promise<boolean> => {
    if (bulkDiscountBusyRef.current) return false;
    const targetDiscountPct = parseFloat(bulkDiscountPercentInput.replace(",", "."));
    if (
      Number.isNaN(targetDiscountPct) ||
      targetDiscountPct < ML_MIN_CAMPAIGN_DISCOUNT_PERCENT ||
      targetDiscountPct > ML_MAX_CAMPAIGN_DISCOUNT_PERCENT
    ) {
      setSaveMessage({
        type: "error",
        text: `Informe um desconto entre ${ML_MIN_CAMPAIGN_DISCOUNT_PERCENT}% e ${ML_MAX_CAMPAIGN_DISCOUNT_PERCENT}%.`,
      });
      setTimeout(() => setSaveMessage(null), 6000);
      return false;
    }
    const selected = listings.filter((l) => selectedIds.has(listingSelectionKey(l)));
    if (selected.length === 0) {
      setSaveMessage({
        type: "error",
        text: "Selecione pelo menos um anúncio para usar ações em massa.",
      });
      setTimeout(() => setSaveMessage(null), 5000);
      return false;
    }
    const eligible = selected.filter(
      (l) => l.current_price > 0 && l.listing_type_id && l.category_id
    );
    if (eligible.length === 0) {
      setSaveMessage({
        type: "error",
        text: "Nenhum anúncio selecionado tem preço no ML e tipo de listagem para calcular. Sincronize os anúncios se necessário.",
      });
      setTimeout(() => setSaveMessage(null), 6000);
      return false;
    }

    const keySet = new Set(eligible.map((l) => listingSelectionKey(l)));
    const priceByKey = new Map<string, number>();
    for (const l of eligible) {
      priceByKey.set(listingSelectionKey(l), promotionPriceForDiscountPercent(l.current_price, targetDiscountPct));
    }
    const pmaClampedCount = clampPriceMapToListingPma(eligible, priceByKey);

    setBulkDiscountModalOpen(false);

    bulkDiscountBusyRef.current = true;
    setListings((prev) =>
      prev.map((item) => {
        const key = listingSelectionKey(item);
        if (!keySet.has(key)) return item;
        const np = priceByKey.get(key)!;
        return { ...item, new_price: np, dirty: true, calculated: undefined };
      })
    );

    setBulkDiscountLoaderProgress({
      done: 0,
      total: eligible.length,
      flightEnd: Math.min(MAX_PRICING_CALCULATE_BATCH, eligible.length),
    });
    setCalculating(true);
    try {
      const itemsToCalculate = eligible.map((item) => ({
        item_id: item.item_id,
        variation_id: item.variation_id,
        price: priceByKey.get(listingSelectionKey(item))!,
        listing_type_id: item.listing_type_id!,
        category_id: item.category_id!,
        weight_kg: item.weight_kg,
        height_cm: item.height_cm,
        width_cm: item.width_cm,
        length_cm: item.length_cm,
        reference_fee_percent: item.reference_fee_percent ?? null,
      }));

      const { results, errors } = await fetchPricingCalculateBatches(
        itemsToCalculate,
        isMercadoLider,
        (done, total, flightEnd) =>
          setBulkDiscountLoaderProgress({
            done,
            total,
            flightEnd: flightEnd == null || flightEnd <= done ? undefined : flightEnd,
          }),
        { linearFees: true }
      );

      const resultsMap = buildPricingResultsMap(results);
      setListings((prev) => applyCalculatedResultsToListings(prev, resultsMap, keySet));

      const toPersist = eligible.map((l) => ({
        item_id: l.item_id,
        variation_id: l.variation_id,
        sku: l.sku ?? undefined,
        planned_price: priceByKey.get(listingSelectionKey(l))!,
      }));
      setBulkDiscountLoaderProgress({
        done: eligible.length,
        total: eligible.length,
        phase: "save",
        saveDone: 0,
        saveTotal: toPersist.length,
      });
      const pres = await persistPlannedPrices(toPersist, {
        quietSuccess: true,
        onSaveProgress: (saveDone, saveTotal) =>
          setBulkDiscountLoaderProgress({
            done: eligible.length,
            total: eligible.length,
            phase: "save",
            saveDone,
            saveTotal,
          }),
      });

      const skippedNoType = selected.length - eligible.length;
      const errCount = errors.length;
      let msg = `Preço calculado ajustado para desconto de ${targetDiscountPct}% em ${eligible.length} anúncio(s) (taxa por referência, sem listing_prices por item).`;
      if (skippedNoType > 0) msg += ` ${skippedNoType} ignorado(s) (sem dados para cálculo).`;
      if (errCount > 0) msg += ` Falha no cálculo em ${errCount} linha(s); ajuste manual ou use Recalcular taxa e frete.`;
      msg += formatPmaClampBulkSuffix(pmaClampedCount);
      if (pres.ok) msg += " Alterações salvas automaticamente.";
      else msg += ` Falha ao gravar no servidor${pres.error ? `: ${pres.error}` : ""}.`;
      setSaveMessage({ type: errCount > 0 || !pres.ok ? "error" : "ok", text: msg });
      setTimeout(() => setSaveMessage(null), 8000);
      return errCount === 0 && pres.ok;
    } catch {
      setSaveMessage({
        type: "error",
        text: "Erro ao recalcular preços após o ajuste em massa.",
      });
      setTimeout(() => setSaveMessage(null), 6000);
      return false;
    } finally {
      bulkDiscountBusyRef.current = false;
      setBulkDiscountLoaderProgress(null);
      setCalculating(false);
    }
  }, [bulkDiscountPercentInput, listings, selectedIds, isMercadoLider, persistPlannedPrices]);

  const handleBulkDiscountConfirm = useCallback(async () => {
    await handleBulkApplyDiscountPercent();
  }, [handleBulkApplyDiscountPercent]);

  /** Preço calculado = preço do anúncio no ML (coluna Preço), com recálculo em lote. */
  const handleBulkRestoreOriginalPrice = useCallback(async () => {
    setBulkActionsOpen(false);
    if (bulkRestoreOriginalBusyRef.current) return;
    const selected = listings.filter((l) => selectedIds.has(listingSelectionKey(l)));
    if (selected.length === 0) {
      setSaveMessage({
        type: "error",
        text: "Selecione pelo menos um anúncio para usar ações em massa.",
      });
      setTimeout(() => setSaveMessage(null), 5000);
      return;
    }
    const eligible = selected.filter(
      (l) => l.current_price > 0 && l.listing_type_id && l.category_id
    );
    if (eligible.length === 0) {
      setSaveMessage({
        type: "error",
        text: "Nenhum anúncio selecionado tem preço no ML e tipo de listagem para calcular. Sincronize os anúncios se necessário.",
      });
      setTimeout(() => setSaveMessage(null), 6000);
      return;
    }

    const keySet = new Set(eligible.map((l) => listingSelectionKey(l)));
    const priceByKey = new Map<string, number>();
    for (const l of eligible) {
      priceByKey.set(listingSelectionKey(l), Math.round(l.current_price * 100) / 100);
    }
    const pmaClampedCount = clampPriceMapToListingPma(eligible, priceByKey);

    bulkRestoreOriginalBusyRef.current = true;
    setListings((prev) =>
      prev.map((item) => {
        const key = listingSelectionKey(item);
        if (!keySet.has(key)) return item;
        const np = priceByKey.get(key)!;
        return { ...item, new_price: np, dirty: true, calculated: undefined };
      })
    );

    setBulkRestoreLoaderProgress({
      done: 0,
      total: eligible.length,
      flightEnd: Math.min(MAX_PRICING_CALCULATE_BATCH, eligible.length),
    });
    setCalculating(true);
    try {
      const itemsToCalculate = eligible.map((item) => ({
        item_id: item.item_id,
        variation_id: item.variation_id,
        price: priceByKey.get(listingSelectionKey(item))!,
        listing_type_id: item.listing_type_id!,
        category_id: item.category_id!,
        weight_kg: item.weight_kg,
        height_cm: item.height_cm,
        width_cm: item.width_cm,
        length_cm: item.length_cm,
        reference_fee_percent: item.reference_fee_percent ?? null,
      }));

      const { results, errors } = await fetchPricingCalculateBatches(
        itemsToCalculate,
        isMercadoLider,
        (done, total, flightEnd) =>
          setBulkRestoreLoaderProgress({
            done,
            total,
            flightEnd: flightEnd == null || flightEnd <= done ? undefined : flightEnd,
          }),
        { linearFees: true }
      );

      const restoreResultsMap = buildPricingResultsMap(results);
      setListings((prev) => applyCalculatedResultsToListings(prev, restoreResultsMap, keySet));

      const toPersistRestore = eligible.map((l) => ({
        item_id: l.item_id,
        variation_id: l.variation_id,
        sku: l.sku ?? undefined,
        planned_price: priceByKey.get(listingSelectionKey(l))!,
      }));
      setBulkRestoreLoaderProgress({
        done: eligible.length,
        total: eligible.length,
        phase: "save",
        saveDone: 0,
        saveTotal: toPersistRestore.length,
      });
      const presRestore = await persistPlannedPrices(toPersistRestore, {
        quietSuccess: true,
        onSaveProgress: (saveDone, saveTotal) =>
          setBulkRestoreLoaderProgress({
            done: eligible.length,
            total: eligible.length,
            phase: "save",
            saveDone,
            saveTotal,
          }),
      });

      const skippedNoType = selected.length - eligible.length;
      const errCount = errors.length;
      let msg = `Preço calculado restaurado para o preço do ML em ${eligible.length} anúncio(s) (taxa por referência, sem listing_prices por item).`;
      if (skippedNoType > 0) msg += ` ${skippedNoType} ignorado(s) (sem preço ou dados para cálculo).`;
      if (errCount > 0) msg += ` Falha no cálculo em ${errCount} linha(s); use Recalcular taxa e frete se precisar.`;
      msg += formatPmaClampBulkSuffix(pmaClampedCount);
      if (presRestore.ok) msg += " Alterações salvas automaticamente.";
      else msg += ` Falha ao gravar no servidor${presRestore.error ? `: ${presRestore.error}` : ""}.`;
      setSaveMessage({ type: errCount > 0 || !presRestore.ok ? "error" : "ok", text: msg });
      setTimeout(() => setSaveMessage(null), 8000);
    } catch {
      setSaveMessage({
        type: "error",
        text: "Erro ao recalcular após restaurar o preço.",
      });
      setTimeout(() => setSaveMessage(null), 6000);
    } finally {
      bulkRestoreOriginalBusyRef.current = false;
      setBulkRestoreLoaderProgress(null);
      setCalculating(false);
    }
  }, [listings, selectedIds, isMercadoLider, persistPlannedPrices]);

  const handleBulkMarginConfirm = useCallback(async () => {
    const targetPct = parseFloat(bulkMarginPercentInput.replace(",", "."));
    if (!Number.isFinite(targetPct)) {
      setSaveMessage({ type: "error", text: "Informe um percentual de margem válido (ex.: 15 ou 15,5)." });
      setTimeout(() => setSaveMessage(null), 5000);
      return;
    }

    if (bulkMarginBusyRef.current) return;

    const selected = listings.filter((l) => selectedIds.has(listingSelectionKey(l)));
    if (selected.length === 0) {
      setSaveMessage({
        type: "error",
        text: "Selecione pelo menos um anúncio para usar ações em massa.",
      });
      setTimeout(() => setSaveMessage(null), 5000);
      return;
    }

    const eligible = selected.filter(
      (l) => l.cost_price != null && l.listing_type_id && l.category_id
    );
    if (eligible.length === 0) {
      setSaveMessage({
        type: "error",
        text: "Nenhum anúncio selecionado tem custo cadastrado e tipo de listagem. Vincule produtos e sincronize anúncios.",
      });
      setTimeout(() => setSaveMessage(null), 7000);
      return;
    }

    const keySet = new Set(eligible.map((l) => listingSelectionKey(l)));
    bulkMarginBusyRef.current = true;
    setBulkMarginModalOpen(false);
    setBulkMarginPercentInput("");

    setListings((prev) =>
      prev.map((item) =>
        keySet.has(listingSelectionKey(item)) ? { ...item, calculating: true } : item
      )
    );

    setCalculating(true);
    setBulkMarginLoaderProgress({ done: 0, total: eligible.length });
    try {
      const updates = new Map<string, { price: number; calculated: CalculatedPricing | undefined }>();
      const { results: bulkResults, errors: bulkErrors } = await solveMarginBulkViaApi(
        eligible,
        targetPct,
        isMercadoLider
      );

      const selectionKeyByPricingKey = new Map<string, string>();
      const eligibleBySelectionKey = new Map<string, ListingWithPricing>();
      for (const l of eligible) {
        const selKey = listingSelectionKey(l);
        eligibleBySelectionKey.set(selKey, l);
        selectionKeyByPricingKey.set(
          pricingResultKey(l.item_id, l.variation_id),
          selKey
        );
      }
      let pmaClampedCount = 0;
      const pmaClampedKeys = new Set<string>();
      for (const r of bulkResults) {
        const selKey = selectionKeyByPricingKey.get(pricingResultKey(r.item_id, r.variation_id));
        if (!selKey) continue;
        const listing = eligibleBySelectionKey.get(selKey);
        const rawPrice = Math.round(r.price * 100) / 100;
        const { price, clamped } = clampPromoPriceToPmaFloor(rawPrice, listing?.pma);
        if (clamped) {
          pmaClampedCount++;
          pmaClampedKeys.add(selKey);
        }
        updates.set(selKey, {
          price,
          calculated: clamped ? undefined : r.calculated,
        });
      }

      setBulkMarginLoaderProgress({ done: eligible.length, total: eligible.length });

      const fail = eligible.length - updates.size;

      setListings((prev) =>
        prev.map((item) => {
          const key = listingSelectionKey(item);
          if (!keySet.has(key)) return item;
          const u = updates.get(key);
          if (u) {
            return {
              ...item,
              new_price: u.price,
              dirty: true,
              calculated: u.calculated,
              calculating: pmaClampedKeys.has(key),
            };
          }
          return { ...item, calculating: false };
        })
      );

      if (pmaClampedKeys.size > 0) {
        const itemsToRecalc = eligible
          .filter((l) => pmaClampedKeys.has(listingSelectionKey(l)))
          .map((item) => ({
            item_id: item.item_id,
            variation_id: item.variation_id,
            price: updates.get(listingSelectionKey(item))!.price,
            listing_type_id: item.listing_type_id!,
            category_id: item.category_id!,
            weight_kg: item.weight_kg,
            height_cm: item.height_cm,
            width_cm: item.width_cm,
            length_cm: item.length_cm,
            reference_fee_percent: item.reference_fee_percent ?? null,
          }));
        const { results: recalcResults } = await fetchPricingCalculateBatches(
          itemsToRecalc,
          isMercadoLider,
          undefined,
          { linearFees: true }
        );
        const recalcMap = buildPricingResultsMap(recalcResults);
        setListings((prev) => {
          const withCalc = applyCalculatedResultsToListings(prev, recalcMap, pmaClampedKeys);
          return withCalc.map((item) =>
            pmaClampedKeys.has(listingSelectionKey(item))
              ? { ...item, calculating: false }
              : item
          );
        });
      } else {
        setListings((prev) =>
          prev.map((item) =>
            keySet.has(listingSelectionKey(item)) ? { ...item, calculating: false } : item
          )
        );
      }

      setBulkMarginLoaderProgress({
        done: eligible.length,
        total: eligible.length,
        phase: "save",
        saveDone: 0,
        saveTotal: eligible.filter((l) => updates.has(listingSelectionKey(l))).length,
      });

      const toPersistMargin = eligible
        .filter((l) => updates.has(listingSelectionKey(l)))
        .map((l) => {
          const u = updates.get(listingSelectionKey(l))!;
          return {
            item_id: l.item_id,
            variation_id: l.variation_id,
            sku: l.sku ?? undefined,
            planned_price: u.price,
          };
        });
      const presMargin = await persistPlannedPrices(toPersistMargin, {
        quietSuccess: true,
        onSaveProgress: (saveDone, saveTotal) =>
          setBulkMarginLoaderProgress({
            done: eligible.length,
            total: eligible.length,
            phase: "save",
            saveDone,
            saveTotal,
          }),
      });

      const skippedNoData = selected.length - eligible.length;
      const ok = updates.size;
      const pctLabel = targetPct.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      let msg = `Margem líquida alvo ${pctLabel}% aplicada em ${ok} anúncio(s) (modo rápido: taxa de referência + frete em tabela).`;
      if (fail > 0) msg += ` ${fail} sem solução ou com erro.`;
      if (skippedNoData > 0) {
        msg += ` ${skippedNoData} ignorado(s) (sem custo ou tipo de anúncio).`;
      }
      msg += formatPmaClampBulkSuffix(pmaClampedCount);
      if (presMargin.ok) msg += " Alterações salvas automaticamente.";
      else msg += ` Falha ao gravar no servidor${presMargin.error ? `: ${presMargin.error}` : ""}.`;
      setSaveMessage({
        type: ok === 0 || !presMargin.ok ? "error" : "ok",
        text: msg,
      });
      setTimeout(() => setSaveMessage(null), 9000);
    } catch {
      setSaveMessage({
        type: "error",
        text: "Erro ao aplicar margem em massa.",
      });
      setTimeout(() => setSaveMessage(null), 6000);
      setListings((prev) =>
        prev.map((item) =>
          keySet.has(listingSelectionKey(item)) ? { ...item, calculating: false } : item
        )
      );
    } finally {
      bulkMarginBusyRef.current = false;
      setBulkMarginLoaderProgress(null);
      setCalculating(false);
    }
  }, [bulkMarginPercentInput, listings, selectedIds, isMercadoLider, persistPlannedPrices]);

  const handleCopyToClipboard = useCallback((value: string, cellKey: string) => {
    if (!value) return;
    const done = () => {
      setCopiedCell(cellKey);
      setTimeout(() => setCopiedCell(null), 1800);
    };
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(() => {});
      return;
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      done();
    } catch {
      // ignore
    }
  }, []);

  const tagNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of allTags) m.set(t.id, t.name);
    return m;
  }, [allTags]);

  const appliedPrecosFilters = useMemo(
    (): PrecosFiltersValues => ({
      search,
      skuFilter,
      supplierFilter,
      statusFilter,
      linkFilter,
      fullOnly,
      filterTagIds,
      sales30dOpFilter,
      sales30dQtyFilter,
      costOpFilter,
      costQtyFilter,
      discountOpFilter,
      discountQtyFilter,
      semPromoMlAtiva,
      profitOpFilter,
      profitQtyFilter,
      hasPmaFilter,
    }),
    [
      search,
      skuFilter,
      supplierFilter,
      statusFilter,
      linkFilter,
      fullOnly,
      filterTagIds,
      sales30dOpFilter,
      sales30dQtyFilter,
      costOpFilter,
      costQtyFilter,
      discountOpFilter,
      discountQtyFilter,
      semPromoMlAtiva,
      profitOpFilter,
      profitQtyFilter,
      hasPmaFilter,
    ]
  );

  const applyPrecosFilters = useCallback((values: PrecosFiltersValues) => {
    setSearch(values.search);
    setSkuFilter(values.skuFilter);
    setSupplierFilter(values.supplierFilter);
    setStatusFilter(values.statusFilter);
    setLinkFilter(values.linkFilter);
    setFullOnly(values.fullOnly);
    setFilterTagIds(values.filterTagIds);
    setSales30dOpFilter(values.sales30dOpFilter);
    setSales30dQtyFilter(values.sales30dQtyFilter);
    setCostOpFilter(values.costOpFilter);
    setCostQtyFilter(values.costQtyFilter);
    setDiscountOpFilter(values.discountOpFilter);
    setDiscountQtyFilter(values.discountQtyFilter);
    setSemPromoMlAtiva(values.semPromoMlAtiva);
    setProfitOpFilter(values.profitOpFilter);
    setProfitQtyFilter(values.profitQtyFilter);
    setHasPmaFilter(values.hasPmaFilter);
    setPage(1);
  }, []);

  const appliedPrecosFilterLabels = useMemo(() => {
    const labels: string[] = [];
    const q = search.trim();
    if (q) labels.push(`Busca: ${q}`);
    const sku = skuFilter.trim();
    if (sku) labels.push(`SKU: ${sku}`);
    const supplier = supplierFilter.trim();
    if (supplier) labels.push(`Fornecedor: ${supplier}`);
    if (statusFilter) {
      const map: Record<string, string> = {
        active: "Ativo",
        paused: "Pausado",
        closed: "Fechado",
        under_review: "Em revisão",
        inactive: "Inativo",
        deleted: "Removido",
        not_yet_active: "Aguardando ativação",
      };
      labels.push(`Status: ${map[statusFilter] ?? statusFilter}`);
    }
    if (linkFilter === "linked") labels.push("Vínculo: só vinculados");
    if (linkFilter === "unlinked") labels.push("Vínculo: só não vinculados");
    if (fullOnly) labels.push("Somente Full");
    if (sales30dOpFilter) {
      const qty = parseInt(sales30dQtyFilter.trim(), 10);
      if (Number.isFinite(qty) && qty >= 0) {
        labels.push(`Vendas 30d ${stockCompareLabel(sales30dOpFilter)} ${qty}`);
      }
    }
    if (costOpFilter) {
      const qty = Number(costQtyFilter.trim().replace(",", "."));
      if (Number.isFinite(qty) && qty >= 0) {
        labels.push(`Custo ${stockCompareLabel(costOpFilter)} ${qty.toFixed(2)}`);
      }
    }
    if (discountOpFilter) {
      const qty = Number(discountQtyFilter.trim().replace(",", "."));
      if (Number.isFinite(qty) && qty >= 0) {
        labels.push(`Desconto ${stockCompareLabel(discountOpFilter)} ${qty}%`);
      }
    }
    if (semPromoMlAtiva) labels.push("Sem Promo ML ativa");
    if (hasPmaFilter === "yes") labels.push("PMA: com valor cadastrado");
    if (hasPmaFilter === "no") labels.push("PMA: sem valor cadastrado");
    if (profitOpFilter) {
      const qty = Number(profitQtyFilter.trim().replace(",", "."));
      if (Number.isFinite(qty) && qty >= 0) {
        labels.push(`Lucratividade ${stockCompareLabel(profitOpFilter)} ${qty}%`);
      }
    }
    if (sortBy === "orders_desc") labels.push("Ordenação: vendas ↓");
    if (sortBy === "orders_asc") labels.push("Ordenação: vendas ↑");
    if (sortBy === "cost_desc") labels.push("Ordenação: custo ↓");
    if (sortBy === "cost_asc") labels.push("Ordenação: custo ↑");
    if (sortBy === "profit_desc") labels.push("Ordenação: lucro ↓");
    if (sortBy === "profit_asc") labels.push("Ordenação: lucro ↑");
    for (const id of filterTagIds) {
      const name = tagNameById.get(id);
      if (name) labels.push(`Tag: ${name}`);
    }
    return labels;
  }, [
    search,
    skuFilter,
    supplierFilter,
    statusFilter,
    linkFilter,
    fullOnly,
    sales30dOpFilter,
    sales30dQtyFilter,
    costOpFilter,
    costQtyFilter,
    discountOpFilter,
    discountQtyFilter,
    semPromoMlAtiva,
    profitOpFilter,
    profitQtyFilter,
    sortBy,
    filterTagIds,
    tagNameById,
    hasPmaFilter,
  ]);

  const clearPrecosFilters = useCallback(() => {
    setSearch("");
    setSkuFilter("");
    setSupplierFilter("");
    setFilterTagIds([]);
    setStatusFilter("");
    setLinkFilter("all");
    setFullOnly(false);
    setSales30dOpFilter("");
    setSales30dQtyFilter("");
    setCostOpFilter("");
    setCostQtyFilter("");
    setDiscountOpFilter("");
    setDiscountQtyFilter("");
    setSemPromoMlAtiva(false);
    setHasPmaFilter("");
    setProfitOpFilter("");
    setProfitQtyFilter("");
    setSortBy("");
    setPage(1);
  }, []);

  const lastUpdatedFormatted = useMemo(() => {
    if (!lastUpdatedAt) return "";
    try {
      return new Date(lastUpdatedAt).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      });
    } catch {
      return lastUpdatedAt;
    }
  }, [lastUpdatedAt]);

  const formatBRL = useCallback((value: number | null | undefined) => {
    if (value == null) return "—";
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, []);

  const dirtyCount = useMemo(
    () => listings.filter((l) => l.dirty).length,
    [listings]
  );

  const itemsWithoutListingType = useMemo(
    () => listings.filter((l) => !l.listing_type_id).length,
    [listings]
  );

  /** % de lucro para exibição e filtros. Com calculated usa lucro líquido; senão usa margem bruta (preço - custo)/preço. */
  const getProfitPercent = useCallback((listing: ListingWithPricing): number | null => {
    if (listing.cost_price == null || listing.new_price <= 0) return null;
    if (listing.calculated) {
      const profit = listing.calculated.net_amount - listing.cost_price;
      return (profit / listing.new_price) * 100;
    }
    const grossProfit = listing.new_price - listing.cost_price;
    return (grossProfit / listing.new_price) * 100;
  }, []);

  /** Filtros e ordenação (vendas, custo, desconto, margem, promo ML) aplicados no servidor via pricing_cache. */
  const filteredListings = listings;

  const totalPages = computeTotalPages(total, pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(Math.max(1, totalPages));
  }, [page, totalPages]);

  /** Força remontagem das linhas ao mudar filtros (evita 1ª linha “fantasma” por reconciliação). */
  const tableFilterEpoch = useMemo(
    () =>
      [
        search,
        statusFilter,
        linkFilter,
        skuFilter,
        supplierFilter,
        filterTagIds.join(","),
        profitOpFilter,
        profitQtyFilter,
        sales30dOpFilter,
        sales30dQtyFilter,
        costOpFilter,
        costQtyFilter,
        discountOpFilter,
        discountQtyFilter,
        semPromoMlAtiva ? "1" : "0",
      ].join("|"),
    [
      search,
      statusFilter,
      linkFilter,
      skuFilter,
      supplierFilter,
      filterTagIds,
      profitOpFilter,
      profitQtyFilter,
      sales30dOpFilter,
      sales30dQtyFilter,
      costOpFilter,
      costQtyFilter,
      discountOpFilter,
      discountQtyFilter,
      semPromoMlAtiva,
    ]
  );

  /**
   * Colunas congeladas: `left` = soma dos minWidth das colunas pinadas anteriores (igual ao `<colgroup>`).
   * Largura vem só do col — não forçar width/maxWidth na célula (evita truncar título/SKU e desalinhar ao pinar colunas extras).
   */
  const { stickyHeaderStyles, stickyBodyStyles } = useMemo(() => {
    const head: (CSSProperties | undefined)[] = Array.from({ length: PRICING_COLUMNS.length }, () => undefined);
    const body: (CSSProperties | undefined)[] = Array.from({ length: PRICING_COLUMNS.length }, () => undefined);
    let left = 0;
    let order = 0;
    for (let i = 0; i < PRICING_COLUMNS.length; i++) {
      if (stickyColumns.has(i)) {
        const w = PRICING_COLUMNS[i].minWidth;
        const base = {
          position: "sticky" as const,
          left,
          boxSizing: "border-box" as const,
        };
        head[i] = { ...base, zIndex: 30 + order };
        body[i] = { ...base, zIndex: 2 + order };
        left += w;
        order++;
      }
    }
    return { stickyHeaderStyles: head, stickyBodyStyles: body };
  }, [stickyColumns]);

  const toggleStickyColumn = useCallback((colIndex: number) => {
    setStickyColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colIndex)) next.delete(colIndex);
      else next.add(colIndex);
      return next;
    });
    setHeaderMenuColumn(null);
  }, []);

  useEffect(() => {
    setStickyColumns(readPrecosStickyInitial());
    setStickyHydrated(true);
  }, []);

  useEffect(() => {
    if (!stickyHydrated) return;
    try {
      localStorage.setItem(
        PRICOS_STICKY_STORAGE_KEY,
        JSON.stringify(Array.from(stickyColumns).sort((a, b) => a - b))
      );
    } catch {
      // ignore quota / private mode
    }
  }, [stickyColumns, stickyHydrated]);

  useEffect(() => {
    if (headerMenuColumn === null) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      const roots =
        typeof document !== "undefined"
          ? document.querySelectorAll("[data-precos-th-menu-root]")
          : null;
      if (roots) {
        for (let i = 0; i < roots.length; i++) {
          if (roots[i].contains(t)) return;
        }
      }
      setHeaderMenuColumn(null);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [headerMenuColumn]);

  useEffect(() => {
    if (!bulkActionsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = bulkActionsRef.current;
      if (el && !el.contains(e.target as Node)) setBulkActionsOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [bulkActionsOpen]);

  useEffect(() => {
    if (!globalActionsOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = globalActionsRef.current;
      if (el && !el.contains(e.target as Node)) setGlobalActionsOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [globalActionsOpen]);

  const sortedListings = filteredListings;

  const filteredSelectionKeys = useMemo(
    () => new Set(filteredListings.map((l) => listingSelectionKey(l))),
    [filteredListings]
  );
  const visibleSelectionKeys = useMemo(
    () => sortedListings.map((l) => listingSelectionKey(l)),
    [sortedListings]
  );
  const visibleSelectionIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    visibleSelectionKeys.forEach((key, index) => map.set(key, index));
    return map;
  }, [visibleSelectionKeys]);
  const lastSelectedKeyRef = useRef<string | null>(null);
  /** Shift é lido no mouseDown (antes do onChange do checkbox). */
  const rowSelectShiftRef = useRef(false);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      prev.forEach((key) => {
        if (filteredSelectionKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [filteredSelectionKeys]);

  useEffect(() => {
    const last = lastSelectedKeyRef.current;
    if (last && !filteredSelectionKeys.has(last)) {
      lastSelectedKeyRef.current = null;
    }
  }, [filteredSelectionKeys]);

  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);

  const handleToggleSelectAll = useCallback(() => {
    const allOnPageSelected =
      sortedListings.length > 0 &&
      sortedListings.every((l) => selectedIds.has(listingSelectionKey(l)));
    if (allOnPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const l of sortedListings) next.delete(listingSelectionKey(l));
        return next;
      });
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const l of sortedListings) next.add(listingSelectionKey(l));
      return next;
    });
  }, [selectedIds, sortedListings]);

  const handleRowSelectChange = useCallback(
    (selectionKey: string, shiftKey: boolean, checked: boolean) => {
      const currentIndex = visibleSelectionIndexByKey.get(selectionKey);
      const anchorKey = lastSelectedKeyRef.current;
      const anchorIndex = anchorKey != null ? visibleSelectionIndexByKey.get(anchorKey) : undefined;

      setSelectedIds((prev) => {
        const next = new Set(prev);

        if (shiftKey && currentIndex != null && anchorIndex != null && anchorKey !== selectionKey) {
          const [start, end] =
            currentIndex < anchorIndex ? [currentIndex, anchorIndex] : [anchorIndex, currentIndex];
          for (let i = start; i <= end; i++) {
            const key = visibleSelectionKeys[i];
            if (key) next.add(key);
          }
        } else if (checked) {
          next.add(selectionKey);
        } else {
          next.delete(selectionKey);
        }

        return next;
      });

      lastSelectedKeyRef.current = selectionKey;
    },
    [visibleSelectionIndexByKey, visibleSelectionKeys]
  );

  const handleOpenCampaign = useCallback(() => {
    const selectedListings = listings.filter((l) => selectedIds.has(listingSelectionKey(l)));
    const invalidForCampaign = selectedListings.filter((l) => !meetsMlMinCampaignDiscount(l));
    if (invalidForCampaign.length > 0) {
      const names = invalidForCampaign.map((l) => l.title || l.item_id).slice(0, 5);
      const more = invalidForCampaign.length > 5 ? ` e mais ${invalidForCampaign.length - 5}` : "";
      setCampaignMessage({
        type: "error",
        text: `O Mercado Livre exige desconto ≥ 5% na promoção. ${invalidForCampaign.length} item(ns) selecionado(s) não atendem: ${names.join(", ")}${more}. Ajuste o preço ou desmarque-os.`,
      });
      return;
    }
    setCampaignMessage(null);
    const today = new Date();
    const toDateInput = (d: Date) => d.toISOString().slice(0, 10);
    const start = toDateInput(today);
    const finishDate = new Date(today);
    finishDate.setDate(finishDate.getDate() + 6);
    const finish = toDateInput(finishDate);
    setCampaignStart(start);
    setCampaignFinish(finish);
    if (!campaignName) {
      const month = (today.getMonth() + 1).toString().padStart(2, "0");
      const year = today.getFullYear().toString().slice(-2);
      setCampaignName(`EP ${month}-${year}`);
    }
    setCampaignOpen(true);
  }, [campaignName, campaignStart, campaignFinish, selectedIds, listings]);

  const handleOpenUpdatePrice = useCallback(() => {
    if (selectedIds.size === 0) {
      setUpdatePriceMessage({ type: "error", text: "Selecione pelo menos um anúncio." });
      return;
    }
    const selectedListings = listings.filter((l) => selectedIds.has(listingSelectionKey(l)));
    const invalid = selectedListings.filter((l) => !(l.new_price > 0));
    if (invalid.length > 0) {
      const names = invalid.map((l) => l.title || l.item_id).slice(0, 5);
      const more = invalid.length > 5 ? ` e mais ${invalid.length - 5}` : "";
      setUpdatePriceMessage({
        type: "error",
        text: `${invalid.length} item(ns) selecionado(s) sem preço calculado válido (> 0): ${names.join(", ")}${more}.`,
      });
      return;
    }
    setUpdatePriceMessage(null);
    setUpdatePriceResult(null);
    setUpdatePriceOpen(true);
  }, [selectedIds, listings]);

  const closeUpdatePriceModal = useCallback(() => {
    setUpdatePriceOpen(false);
    setUpdatePriceResult(null);
    setUpdatePriceLoading(false);
  }, []);

  const handleConfirmUpdatePrice = useCallback(async () => {
    const selectedListings = listings.filter((l) => selectedIds.has(listingSelectionKey(l)));
    if (selectedListings.length === 0) {
      setUpdatePriceMessage({ type: "error", text: "Selecione pelo menos um anúncio." });
      return;
    }

    const items = selectedListings.map((l) => ({
      item_id: l.item_id,
      variation_id: l.variation_id,
      promotion_price: l.new_price,
    }));

    const labelsByKey: Record<string, string> = {};
    for (const l of selectedListings) {
      labelsByKey[updatePriceRowKey(l.item_id, l.variation_id)] =
        l.title?.trim() || l.item_id;
    }

    setUpdatePriceLoading(true);
    setUpdatePriceResult(null);

    try {
      const res = await fetch("/api/mercadolivre/update-item-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      const itemsRaw = (data as { items?: UpdatePriceItemResult[] }).items ?? [];
      const summaryRaw = (data as {
        summary?: { applied?: number; skipped_invalid_price?: number; errors?: number };
      }).summary;

      const summaryFromItems = {
        applied: itemsRaw.filter((i) => i.status === "ok").length,
        skipped: itemsRaw.filter((i) => i.status === "skipped_invalid_price").length,
        errors: itemsRaw.filter((i) => i.status === "error").length,
      };
      const summary = {
        applied: summaryRaw?.applied ?? summaryFromItems.applied,
        skipped: summaryRaw?.skipped_invalid_price ?? summaryFromItems.skipped,
        errors: summaryRaw?.errors ?? summaryFromItems.errors,
      };

      if (!res.ok) {
        setUpdatePriceResult({
          globalError:
            (data as { error?: string }).error ?? "Erro ao atualizar preços no Mercado Livre.",
          summary,
          items: itemsRaw,
          labelsByKey,
        });
        return;
      }

      setUpdatePriceResult({
        summary,
        items: itemsRaw,
        labelsByKey,
      });

      if (summary.applied > 0) {
        setSelectedIds(new Set());
        await loadListings();
      }
    } catch {
      setUpdatePriceResult({
        globalError: "Erro de rede ao atualizar preços no Mercado Livre.",
        summary: { applied: 0, skipped: 0, errors: 0 },
        items: [],
        labelsByKey,
      });
    } finally {
      setUpdatePriceLoading(false);
    }
  }, [selectedIds, listings, loadListings]);

  const handleDownloadUpdatePriceIssuesCsv = useCallback(() => {
    const issues = updatePriceResult?.items.filter((i) => i.status !== "ok") ?? [];
    if (issues.length === 0) return;
    const csv = buildUpdatePriceIssuesCsv(issues);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.download = `precos-ml-nao-atualizados-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [updatePriceResult]);

  const handleCreateCampaign = useCallback(async () => {
    if (!campaignName.trim()) {
      setCampaignMessage({ type: "error", text: "Informe o nome da campanha." });
      return;
    }
    if (!isValidMlSellerCampaignName(campaignName)) {
      setCampaignMessage({
        type: "error",
        text: `Nome da campanha inválido para o Mercado Livre. ${ML_SELLER_CAMPAIGN_NAME_HINT}`,
      });
      return;
    }
    if (!campaignStart || !campaignFinish) {
      setCampaignMessage({ type: "error", text: "Informe data de início e término." });
      return;
    }
    if (selectedIds.size === 0) {
      setCampaignMessage({ type: "error", text: "Selecione pelo menos um anúncio." });
      return;
    }

    const selectedListingsForCampaign = listings.filter((l) => selectedIds.has(listingSelectionKey(l)));
    const validListings = selectedListingsForCampaign.filter((l) => meetsMlMinCampaignDiscount(l));
    if (validListings.length === 0) {
      setCampaignMessage({
        type: "error",
        text: "Nenhum item selecionado atende ao desconto mínimo de 5% do Mercado Livre. Ajuste o preço ou desmarque e selecione outros.",
      });
      return;
    }
    const items = validListings.map((l) => ({
      item_id: l.item_id,
      variation_id: l.variation_id,
    }));

    setCampaignLoading(true);
    setCampaignMessage(null);
    setCampaignIssuesForDownload(null);
    if (campaignMessageDismissRef.current) {
      clearTimeout(campaignMessageDismissRef.current);
      campaignMessageDismissRef.current = null;
    }
    try {
      const res = await fetch("/api/mercadolivre/seller-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName.trim(),
          start_date: campaignStart,
          finish_date: campaignFinish,
          items,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCampaignIssuesForDownload(null);
        setCampaignMessage({
          type: "error",
          text:
            (data as { error?: string; details?: string }).error ||
            (data as { error?: string; details?: string }).details ||
            "Erro ao criar campanha no Mercado Livre.",
        });
        return;
      }

      const itemsRaw = (data as { items?: SellerCampaignItemResult[] }).items ?? [];
      const issues = itemsRaw.filter((i) => i.status !== "ok");
      setCampaignIssuesForDownload(issues.length > 0 ? issues : null);

      const summary = (data as { summary?: { applied?: number; skipped_no_planned_price?: number; errors?: number } }).summary || {};
      const applied = summary.applied ?? 0;
      const skipped = summary.skipped_no_planned_price ?? 0;
      const errors = summary.errors ?? 0;
      const campaign = (data as { campaign?: { id?: string } }).campaign;

      const excluded = selectedListingsForCampaign.length - validListings.length;
      const excludedText = excluded > 0 ? ` ${excluded} ignorado(s) (desconto < 5%).` : "";
      const csvHint =
        issues.length > 0
          ? ` Baixe o CSV abaixo para ver ${issues.length} linha(s) com erro ou sem preço salvo.`
          : "";
      setCampaignMessage({
        type: "ok",
        text: `Campanha criada${campaign?.id ? ` (${campaign.id})` : ""}: ${applied} item(s) incluído(s), ${skipped} sem preço salvo, ${errors} com erro.${excludedText}${csvHint}`,
      });
      setSelectedIds(new Set());
      setCampaignOpen(false);
      const dismissMs = issues.length > 0 ? 45000 : 6000;
      campaignMessageDismissRef.current = setTimeout(() => {
        campaignMessageDismissRef.current = null;
        setCampaignMessage(null);
        setCampaignIssuesForDownload(null);
      }, dismissMs);
    } catch {
      setCampaignIssuesForDownload(null);
      setCampaignMessage({
        type: "error",
        text: "Erro de rede ao criar campanha no Mercado Livre.",
      });
    } finally {
      setCampaignLoading(false);
    }
  }, [campaignName, campaignStart, campaignFinish, selectedIds, listings]);

  const handleDownloadCampaignIssuesCsv = useCallback(() => {
    if (!campaignIssuesForDownload?.length) return;
    const csv = buildCampaignIssuesCsv(campaignIssuesForDownload);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.download = `campanha-ml-nao-incluidos-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [campaignIssuesForDownload]);

  const handleExportPrecosCsv = useCallback(() => {
    if (sortedListings.length === 0) return;
    const csv = buildPrecosExportCsv(
      sortedListings,
      ordersData,
      priceRefsByRow,
      getProfitPercent,
      priceRounding
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `precos_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedListings, ordersData, priceRefsByRow, getProfitPercent, priceRounding]);

  const openPrecosImportCsv = useCallback(() => {
    setPrecosImportResult(null);
    setPrecosImportCsvModalOpen(true);
  }, []);

  const onPrecosImportFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setPrecosImportCsvModalOpen(false);
    setPrecosImportLoading(true);
    setPrecosImportResult(null);
    setPrecosImportLoaderProgress({ done: 0, total: 0, stage: "parse" });
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parsePrecosImportCsv(buffer);
      if (parsed.headerError) {
        const data = {
          ok: false,
          total_rows: parsed.total_rows,
          valid_rows: 0,
          error_rows: parsed.total_rows,
          errors: [{ row: 0, field: "header", message: parsed.headerError }],
          preview: [] as PrecosImportPreviewRow[],
          valid_items: [] as PrecosImportRowValid[],
        };
        setPrecosImportResult(data);
        setSaveMessage({ type: "error", text: parsed.headerError });
        setTimeout(() => setSaveMessage(null), 6000);
        return;
      }
      const data = {
        ok: parsed.ok,
        total_rows: parsed.total_rows,
        valid_rows: parsed.valid_rows,
        error_rows: parsed.error_rows,
        errors_truncated: parsed.errors_truncated,
        errors: parsed.errors,
        preview: parsed.preview,
        valid_items: parsed.valid_items,
      };
      setPrecosImportResult(data);
      if (!parsed.ok && parsed.errors.length > 0) {
        setSaveMessage({
          type: "error",
          text: parsed.errors[0]?.message ?? "Erro no CSV.",
        });
        setTimeout(() => setSaveMessage(null), 6000);
      }
    } catch {
      setSaveMessage({
        type: "error",
        text: "Não foi possível ler o arquivo CSV. Verifique o formato e tente novamente.",
      });
      setTimeout(() => setSaveMessage(null), 6000);
    } finally {
      setPrecosImportLoading(false);
      setPrecosImportLoaderProgress(null);
    }
  }, []);

  const cancelPrecosImport = useCallback(() => {
    setPrecosImportResult(null);
  }, []);

  const confirmPrecosImport = useCallback(async () => {
    const items = precosImportResult?.valid_items;
    if (!items?.length) {
      setSaveMessage({ type: "error", text: "Nada a confirmar (sem linhas válidas no CSV)." });
      setTimeout(() => setSaveMessage(null), 5000);
      return;
    }
    setPrecosImportConfirming(true);
    setSaveMessage(null);
    setPrecosImportLoaderProgress({ done: 0, total: items.length, stage: "confirm" });
    const batchSize = PRICING_IMPORT_CONFIRM_CLIENT_BATCH_SIZE;
    let totalSaved = 0;
    const allErrors: Array<{ item_id: string; variation_id: number | null; error: string }> = [];
    try {
      for (let offset = 0; offset < items.length; offset += batchSize) {
        const chunk = items.slice(offset, offset + batchSize);
        setPrecosImportLoaderProgress({
          done: offset,
          total: items.length,
          stage: "confirm",
        });
        const res = await fetch("/api/pricing/import/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ items: chunk, is_mercado_lider: isMercadoLider }),
        });
        const raw = await res.text();
        let data = {} as {
          ok?: boolean;
          saved?: number;
          errors?: Array<{ item_id: string; variation_id: number | null; error: string }>;
          error?: string;
          message?: string;
        };
        try {
          data = raw ? (JSON.parse(raw) as typeof data) : {};
        } catch {
          setSaveMessage({
            type: "error",
            text:
              res.status === 413
                ? "Lote muito grande para o servidor. Tente importar em partes menores."
                : `Erro do servidor (${res.status}) no lote ${Math.floor(offset / batchSize) + 1}.`,
          });
          setTimeout(() => setSaveMessage(null), 7000);
          return;
        }
        if (!res.ok) {
          const batchNum = Math.floor(offset / batchSize) + 1;
          setSaveMessage({
            type: "error",
            text:
              res.status === 401
                ? (data.error ??
                  "Sessão expirada. Atualize a página (F5) e confirme a importação novamente.")
                : (data.error ??
                  `Erro ao confirmar importação (lote ${batchNum}).`),
          });
          setTimeout(() => setSaveMessage(null), 9000);
          return;
        }
        totalSaved += data.saved ?? 0;
        if (data.errors?.length) allErrors.push(...data.errors);
        setPrecosImportLoaderProgress({
          done: Math.min(offset + chunk.length, items.length),
          total: items.length,
          stage: "confirm",
        });
      }
      const errCount = allErrors.length;
      let msg = `Importação concluída: ${totalSaved} preço(s) atualizado(s) por MLB.`;
      if (errCount > 0) msg += ` ${errCount} linha(s) com aviso ou erro.`;
      setSaveMessage({
        type: totalSaved > 0 ? "ok" : "error",
        text: msg,
      });
      setTimeout(() => setSaveMessage(null), 9000);
      setPrecosImportResult(null);
      await loadListings();
    } catch {
      setSaveMessage({ type: "error", text: "Erro de conexão ao confirmar importação." });
      setTimeout(() => setSaveMessage(null), 6000);
    } finally {
      setPrecosImportConfirming(false);
      setPrecosImportLoaderProgress(null);
    }
  }, [precosImportResult, isMercadoLider, loadListings]);

  function renderPricingHeaderMenu(
    colIndex: number,
    opts?: { sortMode?: "orders" | "cost" | "profit" }
  ) {
    if (headerMenuColumn !== colIndex) return null;
    return (
      <div className="btn-dropdown-menu left-1 top-full z-50 mt-1 w-52 font-normal normal-case tracking-normal shadow-xl">
        {opts?.sortMode === "orders" && (
          <>
            <button
              type="button"
              onClick={() => {
                setSortBy("orders_desc");
                setPage(1);
                setHeaderMenuColumn(null);
              }}
              className="btn-dropdown-item"
            >
              Mais vendidos primeiro
            </button>
            <button
              type="button"
              onClick={() => {
                setSortBy("orders_asc");
                setPage(1);
                setHeaderMenuColumn(null);
              }}
              className="btn-dropdown-item"
            >
              Menos vendidos primeiro
            </button>
            <button
              type="button"
              onClick={() => {
                setSortBy("");
                setPage(1);
                setHeaderMenuColumn(null);
              }}
              className="btn-dropdown-item"
            >
              Sem ordenação por vendas
            </button>
          </>
        )}
        {opts?.sortMode === "cost" && (
          <>
            <button
              type="button"
              onClick={() => {
                setSortBy("cost_desc");
                setPage(1);
                setHeaderMenuColumn(null);
              }}
              className="btn-dropdown-item"
            >
              Maior custo primeiro
            </button>
            <button
              type="button"
              onClick={() => {
                setSortBy("cost_asc");
                setPage(1);
                setHeaderMenuColumn(null);
              }}
              className="btn-dropdown-item"
            >
              Menor custo primeiro
            </button>
            <button
              type="button"
              onClick={() => {
                setSortBy("");
                setPage(1);
                setHeaderMenuColumn(null);
              }}
              className="btn-dropdown-item"
            >
              Sem ordenação por custo
            </button>
          </>
        )}
        {opts?.sortMode === "profit" && (
          <>
            <button
              type="button"
              onClick={() => {
                setSortBy("profit_desc");
                setPage(1);
                setHeaderMenuColumn(null);
              }}
              className="btn-dropdown-item"
            >
              Maior lucro primeiro
            </button>
            <button
              type="button"
              onClick={() => {
                setSortBy("profit_asc");
                setPage(1);
                setHeaderMenuColumn(null);
              }}
              className="btn-dropdown-item"
            >
              Menor lucro primeiro
            </button>
            <button
              type="button"
              onClick={() => {
                setSortBy("");
                setPage(1);
                setHeaderMenuColumn(null);
              }}
              className="btn-dropdown-item"
            >
              Sem ordenação por lucro
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => toggleStickyColumn(colIndex)}
          className={`btn-dropdown-item ${opts?.sortMode ? "border-t border-slate-100 dark:border-slate-600" : ""}`}
        >
          {stickyColumns.has(colIndex) ? "Descongelar coluna" : "Congelar coluna"}
        </button>
      </div>
    );
  }

  function renderPricingColumnHeader(
    colIndex: number,
    label: ReactNode,
    options?: {
      align?: "left" | "right";
      sortMode?: "orders" | "cost" | "profit";
      title?: string;
      thExtraClass?: string;
    }
  ) {
    const align = options?.align ?? "left";
    const stickyClass = stickyColumns.has(colIndex) ? "sticky-col" : "";
    const thExtra = options?.thExtraClass ?? "";
    return (
      <th
        data-precos-th-menu-root
        className={`relative select-none p-2 text-xs font-semibold uppercase tracking-wide text-white/90 ${
          align === "right" ? "text-right" : "text-left"
        } ${stickyClass} ${thExtra}`.trim()}
        style={stickyHeaderStyles[colIndex]}
        title={options?.title}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setHeaderMenuColumn((c) => (c === colIndex ? null : colIndex));
          }}
          className={`inline-flex w-full min-w-0 items-center gap-1 rounded-sm hover:bg-white/10 ${
            align === "right" ? "justify-end" : "justify-between"
          }`}
          aria-expanded={headerMenuColumn === colIndex}
        >
          <span
            className={`min-w-0 truncate font-semibold uppercase tracking-wide ${
              align === "right" ? "text-right" : "text-left"
            }`}
          >
            {label}
          </span>
          <span className="shrink-0 text-[10px] leading-none text-white/65">▾</span>
        </button>
        {renderPricingHeaderMenu(colIndex, { sortMode: options?.sortMode })}
      </th>
    );
  }

  const refRefreshing =
    !!refJobId && (refJob?.status === "queued" || refJob?.status === "running");

  const precosImportLoaderActive =
    precosImportLoaderProgress != null && (precosImportLoading || precosImportConfirming);

  const loaderOpen =
    cacheRefreshing ||
    calculating ||
    refRefreshing ||
    precosImportLoaderActive ||
    listingsRefetching;

  const bulkMarginLoaderActive = bulkMarginLoaderProgress != null && calculating;
  const bulkDiscountLoaderActive = bulkDiscountLoaderProgress != null && calculating;
  const bulkRestoreLoaderActive = bulkRestoreLoaderProgress != null && calculating;
  const bulkProgressLoaderActive =
    bulkMarginLoaderActive || bulkDiscountLoaderActive || bulkRestoreLoaderActive;

  const loaderMessages =
    precosImportLoaderActive && precosImportLoaderProgress
      ? precosImportLoaderProgress.stage === "parse"
        ? ["Lendo arquivo CSV…", "Validando colunas MLB, Preço Calculado e Margem %…"]
        : [
            `Salvando preços: ${precosImportLoaderProgress.done} de ${precosImportLoaderProgress.total} linha(s)…`,
            "Gravando preços planejados e atualizando cache…",
          ]
    : bulkMarginLoaderActive
    ? [bulkBatchLoaderMessage(bulkMarginLoaderProgress!)]
    : bulkDiscountLoaderActive
      ? [bulkBatchLoaderMessage(bulkDiscountLoaderProgress)]
      : bulkRestoreLoaderActive
        ? [bulkBatchLoaderMessage(bulkRestoreLoaderProgress)]
        : listingsRefetching
          ? isAllPageSize(pageSize)
            ? [
                "Carregando todos os anúncios…",
                "Com muitos anúncios isso pode levar alguns instantes…",
                "Aguarde — a tela está atualizando…",
              ]
            : [
                "Atualizando lista de anúncios…",
                "Aplicando filtros e quantidade de linhas…",
                "Aguarde — a tela está atualizando…",
              ]
          : refRefreshing
            ? [
                "Atualizando competitividade…",
                "Consultando sugestões no Mercado Livre…",
                "Gravando indicadores na tabela…",
              ]
            : undefined;
  const loaderPhase = precosImportLoaderActive
    ? precosImportLoaderProgress?.stage === "confirm"
      ? "calculate"
      : "default"
    : cacheRefreshing
      ? "refresh-cache"
      : calculating
        ? "calculate"
        : "default";
  const loaderDeterminatePercent = (() => {
    if (
      precosImportLoaderActive &&
      precosImportLoaderProgress?.stage === "confirm" &&
      precosImportLoaderProgress.total > 0
    ) {
      const p = precosImportLoaderProgress;
      return (p.done / p.total) * 100;
    }
    if (bulkDiscountLoaderActive && bulkDiscountLoaderProgress != null) {
      const p = bulkDiscountLoaderProgress;
      if (!calculating || p.total <= 0) return null;
      return bulkBatchLoaderDeterminatePercent(p);
    }
    if (bulkRestoreLoaderActive && bulkRestoreLoaderProgress != null) {
      const p = bulkRestoreLoaderProgress;
      if (!calculating || p.total <= 0) return null;
      return bulkBatchLoaderDeterminatePercent(p);
    }
    const p = bulkMarginLoaderActive ? bulkMarginLoaderProgress : null;
    if (p == null || !calculating || p.total <= 0) return null;
    return bulkBatchLoaderDeterminatePercent(p);
  })();
  const loaderFooter = bulkProgressLoaderActive
    ? ""
    : precosImportLoaderActive
      ? precosImportLoaderProgress?.stage === "confirm"
        ? "Não feche esta aba até concluir a importação."
        : "Validando o arquivo antes de exibir o preview…"
      : listingsRefetching
        ? isAllPageSize(pageSize)
          ? "Carregando todos os anúncios — não feche esta aba até concluir."
          : "Atualizando a lista — não feche esta aba até concluir."
        : undefined;

  return (
    <div className="adminty-precos-page space-y-5">
      <div className="table-page-shell">
      <SmartLoaderOverlay
        open={loaderOpen}
        messages={loaderMessages}
        phase={loaderPhase}
        determinatePercent={loaderDeterminatePercent}
        footerHint={loaderFooter}
      />

      {campaignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setCampaignOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg bg-card p-6 shadow-xl dark:border dark:border-slate-600">
            <h2 className="mb-4 text-lg font-semibold">Criar campanha no Mercado Livre</h2>
            <div className="space-y-3 text-sm">
              <div>
                <label className="mb-1 block text-fg">Nome da campanha</label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(sanitizeMlSellerCampaignNameInput(e.target.value))}
                  className="input w-full py-2 text-sm"
                  placeholder="Ex.: Campanha precos marco"
                  autoComplete="off"
                />
                <p className="mt-1 text-xs text-fg-muted">{ML_SELLER_CAMPAIGN_NAME_HINT}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-fg">Início</label>
                  <input
                    type="date"
                    value={campaignStart}
                    onChange={(e) => setCampaignStart(e.target.value)}
                    className="input w-full py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-fg">Término</label>
                  <input
                    type="date"
                    value={campaignFinish}
                    onChange={(e) => setCampaignFinish(e.target.value)}
                    className="input w-full py-2 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-fg-muted">
                Use os anúncios selecionados nesta página. O preço de cada item virá do &quot;Preço Calculado&quot; salvo (planned_price).
              </p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCampaignOpen(false)}
                className="btn btn-secondary px-4 py-2 text-sm"
                disabled={campaignLoading}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreateCampaign}
                disabled={campaignLoading}
                className="btn btn-primary text-sm disabled:opacity-50"
              >
                {campaignLoading ? "Criando…" : "Criar campanha"}
              </button>
            </div>
          </div>
        </div>
      )}

      {updatePriceOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-price-modal-title"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !updatePriceLoading && closeUpdatePriceModal()}
          />
          <div className="relative flex max-h-[min(92vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-card shadow-xl dark:border dark:border-slate-600">
            <div className="shrink-0 border-b border-slate-200 px-6 py-4 dark:border-slate-600">
              <h2 id="update-price-modal-title" className="text-lg font-semibold">
                {updatePriceResult ? "Resultado da atualização no ML" : "Atualizar preço no Mercado Livre"}
              </h2>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm text-fg">
              {updatePriceLoading ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
                  <p className="font-medium">Enviando preços ao Mercado Livre…</p>
                  <p className="text-xs text-fg-muted">
                    Aguarde — pode levar alguns segundos por anúncio.
                  </p>
                </div>
              ) : updatePriceResult ? (
                (() => {
                  const { summary, items, labelsByKey, globalError } = updatePriceResult;
                  const okItems = items.filter((i) => i.status === "ok");
                  const issueItems = items.filter((i) => i.status !== "ok");
                  const allFailed =
                    !globalError && summary.applied === 0 && items.length > 0;
                  return (
                    <div className="space-y-4">
                      {globalError ? (
                        <div className="rounded border border-red-200 bg-red-50 p-3 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                          <p className="font-medium">{globalError}</p>
                          {items.length === 0 ? (
                            <p className="mt-1 text-xs">
                              Nenhum anúncio foi processado. Verifique sua conexão com o ML e tente novamente.
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {items.length > 0 ? (
                        <div
                          className={`rounded border p-3 text-sm ${
                            summary.applied > 0 && summary.errors === 0
                              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100"
                              : summary.applied > 0
                                ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
                                : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100"
                          }`}
                        >
                          <p className="font-semibold">
                            {summary.applied > 0 && summary.errors === 0
                              ? "Todos os anúncios selecionados foram atualizados."
                              : summary.applied > 0
                                ? "Atualização concluída com avisos."
                                : allFailed
                                  ? "Nenhum anúncio foi atualizado."
                                  : "Nada a atualizar."}
                          </p>
                          <ul className="mt-2 space-y-0.5 text-xs">
                            <li>
                              <strong>{summary.applied}</strong> atualizado(s) com sucesso no ML
                            </li>
                            {summary.skipped > 0 ? (
                              <li>
                                <strong>{summary.skipped}</strong> ignorado(s) (preço calculado inválido ou zero)
                              </li>
                            ) : null}
                            {summary.errors > 0 ? (
                              <li>
                                <strong>{summary.errors}</strong> com erro da API do Mercado Livre
                              </li>
                            ) : null}
                          </ul>
                        </div>
                      ) : null}

                      {issueItems.length > 0 ? (
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Não atualizados ({issueItems.length})
                          </p>
                          <ul className="max-h-48 space-y-2 overflow-y-auto rounded border border-slate-200 bg-slate-50/80 p-2 dark:border-slate-600 dark:bg-slate-900/40">
                            {issueItems.map((row) => {
                              const key = updatePriceRowKey(row.item_id, row.variation_id);
                              const label = labelsByKey[key] || row.item_id;
                              const detail =
                                row.status === "error"
                                  ? row.error
                                  : "Preço Calculado inválido ou zero na linha selecionada";
                              return (
                                <li
                                  key={key}
                                  className="rounded border border-red-100 bg-card px-2 py-1.5 text-xs dark:border-red-900/40"
                                >
                                  <span className="font-medium text-slate-800 dark:text-slate-100">
                                    {label}
                                  </span>
                                  <span className="ml-1 text-slate-500 dark:text-slate-400">
                                    ({row.item_id}
                                    {row.variation_id != null ? ` · var ${row.variation_id}` : ""})
                                  </span>
                                  <p className="mt-0.5 text-red-700 dark:text-red-300">{detail}</p>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}

                      {okItems.length > 0 ? (
                        <details className="rounded border border-slate-200 dark:border-slate-600">
                          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                            Atualizados com sucesso ({okItems.length})
                          </summary>
                          <ul className="max-h-36 space-y-1 overflow-y-auto border-t border-slate-200 px-3 py-2 dark:border-slate-600">
                            {okItems.map((row) => {
                              const key = updatePriceRowKey(row.item_id, row.variation_id);
                              const label = labelsByKey[key] || row.item_id;
                              return (
                                <li key={key} className="text-xs text-slate-600 dark:text-slate-300">
                                  <span className="font-medium text-slate-800 dark:text-slate-100">
                                    {label}
                                  </span>{" "}
                                  — R${" "}
                                  {row.price.toLocaleString("pt-BR", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                  {row.warnings?.length ? (
                                    <span className="block text-amber-700 dark:text-amber-300">
                                      {row.warnings.join(" · ")}
                                    </span>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  );
                })()
              ) : (
                <div className="space-y-3">
                  <p>
                    Serão atualizados <strong>{selectedCount}</strong> anúncio(s) selecionado(s). O valor enviado é o da
                    coluna <strong>Preço Calculado</strong> de cada linha.
                  </p>
                  <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                    <p className="mb-2 font-medium">Impactos no Mercado Livre</p>
                    <ul className="list-inside list-disc space-y-1">
                      <li>
                        Se houver promoção ativa e o novo preço ficar <strong>abaixo</strong> dela, a promoção pode ser
                        removida.
                      </li>
                      <li>
                        Promoções programadas (DEALS) não mudam até a data de início; o preço standard é alterado agora.
                      </li>
                      <li>
                        Anúncios com <strong>automatização de preços</strong> ativa podem rejeitar a alteração ou
                        ignorar o valor — verifique no ML.
                      </li>
                      <li>
                        Em categorias com desconto de frete automático (MLB), alterar o preço pode remover o benefício
                        se ficar abaixo do mínimo.
                      </li>
                    </ul>
                  </div>
                  <p className="text-xs text-fg-muted">
                    Após sucesso, o anúncio é sincronizado e a coluna Preço ML é atualizada na tabela.
                  </p>
                </div>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-600">
              {updatePriceResult &&
              updatePriceResult.items.some((i) => i.status !== "ok") ? (
                <button
                  type="button"
                  onClick={handleDownloadUpdatePriceIssuesCsv}
                  className="btn btn-secondary px-4 py-2 text-sm"
                >
                  Baixar CSV dos erros
                </button>
              ) : null}
              {updatePriceResult ? (
                <button
                  type="button"
                  onClick={closeUpdatePriceModal}
                  className="btn btn-primary px-4 py-2 text-sm"
                >
                  Fechar
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={closeUpdatePriceModal}
                    className="btn btn-secondary px-4 py-2 text-sm"
                    disabled={updatePriceLoading}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmUpdatePrice()}
                    disabled={updatePriceLoading}
                    className="btn btn-primary text-sm disabled:opacity-50"
                  >
                    Atualizar preço no ML
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {bulkDiscountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !bulkDiscountBusyRef.current && setBulkDiscountModalOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg bg-card p-6 shadow-xl dark:border dark:border-slate-600">
            <h2 className="mb-2 text-lg font-semibold">Desconto em massa (selecionados)</h2>
            <p className="mb-4 text-xs text-fg-muted">
              Defina o desconto de promoção para os itens selecionados. Mínimo {ML_MIN_CAMPAIGN_DISCOUNT_PERCENT}% (regra ML) e máximo {ML_MAX_CAMPAIGN_DISCOUNT_PERCENT}% para modalidades configuráveis pelo seller (LIGHTNING, DOD, SELLER_CAMPAIGN, DEAL e PRICE_DISCOUNT). Ao aplicar, o modal fecha e a taxa é estimada pela referência do cache (sem listing_prices por item); use <strong>Recalcular taxa e frete</strong> (menu Ações) se quiser alinhar ao ML.
            </p>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleBulkDiscountConfirm();
              }}
            >
              <div>
                <label className="mb-1 block text-sm text-fg">Desconto desejado (%)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={bulkDiscountPercentInput}
                  onChange={(e) => setBulkDiscountPercentInput(e.target.value)}
                  className="input w-full py-2 text-sm"
                  placeholder={`Ex.: ${ML_MIN_CAMPAIGN_DISCOUNT_PERCENT} ou 12,5`}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBulkDiscountModalOpen(false)}
                  className="btn btn-secondary px-4 py-2 text-sm"
                  disabled={bulkDiscountBusyRef.current}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={bulkDiscountBusyRef.current}
                  className="btn btn-primary text-sm disabled:opacity-50"
                >
                  Aplicar nos selecionados
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bulkMarginModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !bulkMarginBusyRef.current && setBulkMarginModalOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg bg-card p-6 shadow-xl dark:border dark:border-slate-600">
            <h2 className="mb-2 text-lg font-semibold">Margem nos selecionados</h2>
            <p className="mb-4 text-xs text-fg-muted">
              Aplica a mesma margem líquida desejada (valor a receber − custo, sobre o preço calculado) em todos os anúncios marcados que tenham custo e tipo de listagem. Processamento em lote no servidor (taxa de referência + frete em tabela, até 3 passadas por faixa de frete). Confira depois com <strong>Recalcular taxa e frete</strong> (menu Ações) se quiser alinhar a taxa exata do ML.
            </p>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleBulkMarginConfirm();
              }}
            >
              <div>
                <label className="mb-1 block text-sm text-fg">Margem líquida desejada (%)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={bulkMarginPercentInput}
                  onChange={(e) => setBulkMarginPercentInput(e.target.value)}
                  className="input w-full py-2 text-sm"
                  placeholder="Ex.: 18 ou 12,5"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBulkMarginModalOpen(false)}
                  className="btn btn-secondary px-4 py-2 text-sm"
                  disabled={bulkMarginBusyRef.current}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={bulkMarginBusyRef.current}
                  className="btn btn-primary text-sm disabled:opacity-50"
                >
                  Aplicar nos selecionados
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

        <div className="table-page-toolbar">
          <div className="flex flex-wrap items-end gap-1">
            <button
              type="button"
              onClick={() => setPrecosTab("calculadora")}
              className={
                precosTab === "calculadora"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Calculadora
            </button>
            <button
              type="button"
              onClick={() => setPrecosTab("como-funciona")}
              className={
                precosTab === "como-funciona"
                  ? "border-b-2 border-[#0d6efd] px-3 py-2 text-[13px] font-semibold text-[#0d6efd]"
                  : "border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }
            >
              Como funciona?
            </button>
          </div>
        </div>

        {precosTab === "como-funciona" && (
          <div className="table-page-filters">
            <PrecosHelpContent />
          </div>
        )}

        {precosTab === "calculadora" && (
        <div>
        <input
          ref={precosImportFileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={onPrecosImportFileChange}
        />
        <div className="border-b border-slate-100 px-3 py-3 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-3">
          <div className="btn-dropdown relative" ref={globalActionsRef}>
            <button
              type="button"
              onClick={() => setGlobalActionsOpen((o) => !o)}
              className="btn btn-secondary btn-sm"
              title="Atualizar cache, competitividade ou recalcular taxa e frete"
              aria-expanded={globalActionsOpen}
              aria-haspopup="menu"
            >
              Ações
              <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {globalActionsOpen && (
              <div
                className="btn-dropdown-menu left-0 top-full min-w-[260px]"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={cacheRefreshing || loading}
                  onClick={() => {
                    setGlobalActionsOpen(false);
                    void handleRefreshCache();
                  }}
                  className="btn-dropdown-item"
                  title="Atualiza anúncios, vínculos MLB-SKU e vendas 30d no cache"
                >
                  {cacheRefreshing ? "Atualizando dados…" : "Atualizar dados"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={refRefreshing || cacheRefreshing || (!mlAccountId && listings.length === 0)}
                  onClick={() => {
                    setGlobalActionsOpen(false);
                    void handleRefreshPriceReferences();
                  }}
                  className="btn-dropdown-item"
                  title="Atualiza a coluna Competitividade no Mercado Livre, sem refazer o cache inteiro de anúncios"
                >
                  {refRefreshing ? "Atualizando competitividade…" : "Atualizar competitividade"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={calculating || listings.length === 0}
                  onClick={() => {
                    setGlobalActionsOpen(false);
                    handleCalculateAll();
                  }}
                  className="btn-dropdown-item"
                  title={
                    total > listings.length
                      ? `Recalcula taxa e frete para todos os ${total} anúncios do filtro atual (não só esta página)`
                      : "Recalcula taxa e frete para todas as linhas carregadas (preço calculado atual)"
                  }
                >
                  {calculating ? "Recalculando taxa e frete…" : "Recalcular taxa e frete"}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleOpenCampaign}
            disabled={listings.length === 0 || selectedCount === 0}
            className="btn btn-primary btn-sm disabled:cursor-not-allowed"
          >
            Criar campanha ML ({selectedCount})
          </button>
          <button
            type="button"
            onClick={handleOpenUpdatePrice}
            disabled={listings.length === 0 || selectedCount === 0 || updatePriceLoading}
            className="btn btn-sm border-2 border-yellow-400 bg-white text-amber-950 shadow-sm hover:bg-yellow-50 focus:ring-yellow-400/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-yellow-500 dark:bg-slate-900 dark:text-yellow-100 dark:hover:bg-yellow-950/40"
            title="Envia o valor da coluna Preço Calculado como preço do anúncio no Mercado Livre"
          >
            {updatePriceLoading ? "Atualizando…" : `Atualizar preço ML (${selectedCount})`}
          </button>
          <div className="btn-dropdown relative" ref={bulkActionsRef}>
            <button
              type="button"
              onClick={() => setBulkActionsOpen((o) => !o)}
              disabled={listings.length === 0 || selectedCount === 0}
              title={
                selectedCount === 0
                  ? "Selecione anúncios na primeira coluna"
                  : calculating
                    ? "Há um cálculo em andamento; aguarde ou use a ação quando terminar"
                    : "Ações aplicadas aos anúncios selecionados"
              }
              className="btn btn-secondary btn-sm disabled:cursor-not-allowed"
            >
              Ações em massa
              <svg className="h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {bulkActionsOpen && (
              <div className="btn-dropdown-menu left-0 top-full min-w-[280px]" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setBulkActionsOpen(false);
                    setBulkDiscountPercentInput(String(ML_MIN_CAMPAIGN_DISCOUNT_PERCENT));
                    setBulkDiscountModalOpen(true);
                  }}
                  disabled={calculating}
                  className="btn-dropdown-item"
                  title={`Aplica desconto de promoção em massa (${ML_MIN_CAMPAIGN_DISCOUNT_PERCENT}% a ${ML_MAX_CAMPAIGN_DISCOUNT_PERCENT}%) nos selecionados`}
                >
                  {calculating
                    ? "Aguarde o cálculo em andamento…"
                    : `Definir desconto em massa… (${ML_MIN_CAMPAIGN_DISCOUNT_PERCENT}% a ${ML_MAX_CAMPAIGN_DISCOUNT_PERCENT}%)`}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleBulkRestoreOriginalPrice()}
                  disabled={calculating}
                  className="btn-dropdown-item"
                  title="Define o preço calculado igual ao preço do Mercado Livre (última sync) em cada selecionado"
                  >
                  Restaurar preço calculado (ML)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setBulkActionsOpen(false);
                    setBulkMarginPercentInput("");
                    setBulkMarginModalOpen(true);
                  }}
                  disabled={calculating}
                  className="btn-dropdown-item"
                  title="Margem em massa em modo rápido (sem refinamento ML por item). Informe o % desejado."
                >
                  Definir margem líquida (%)…
                </button>
              </div>
            )}
          </div>
        </div>
        </div>

        <div className="pricing-filter-bar">
          <div className="pricing-filter-bar-meta flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[12px]">
            <span className="pricing-filter-bar-label">Filtros:</span>
            {listingsRefetching && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-[#0d6efd]/35 bg-[#0d6efd]/10 px-2.5 py-1 text-[11px] font-semibold text-[#0d6efd] shadow-sm dark:border-[#6ea8fe]/40 dark:bg-[#0d6efd]/20 dark:text-[#9ec5fe]"
                role="status"
                aria-live="polite"
              >
                <span
                  className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-[#0d6efd]/30 border-t-[#0d6efd] dark:border-t-[#9ec5fe]"
                  aria-hidden
                />
                Atualizando lista…
              </span>
            )}
            {appliedPrecosFilterLabels.length > 0 ? (
              appliedPrecosFilterLabels.map((label, idx) => (
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
            {appliedPrecosFilterLabels.length > 0 && (
              <button
                type="button"
                onClick={() => clearPrecosFilters()}
                className="text-[11px] font-semibold text-[#0d6efd] hover:underline"
              >
                Limpar
              </button>
            )}
          </div>
          <PrecosToolbarIcons
            applied={appliedPrecosFilters}
            allTags={allTags}
            onApply={applyPrecosFilters}
            onClearAll={clearPrecosFilters}
            lastUpdatedAt={lastUpdatedAt}
            lastUpdatedFormatted={lastUpdatedFormatted}
            exportDisabled={sortedListings.length === 0}
            precosImportLoading={precosImportLoading}
            onOpenImport={openPrecosImportCsv}
            onExport={handleExportPrecosCsv}
            onRefreshTable={() => void loadListings()}
          />
        </div>

      {saveMessage && (
        <div
          className={`mb-4 rounded p-3 text-sm ${
            saveMessage.type === "ok"
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {saveMessage.text}
        </div>
      )}

      {refreshError && !cacheEmpty && (
        <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {refreshError}
          <button type="button" onClick={() => setRefreshError(null)} className="ml-2 underline">Fechar</button>
        </div>
      )}
      {campaignMessage && (
        <div
          className={`mb-4 rounded p-3 text-sm ${
            campaignMessage.type === "ok"
              ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200"
              : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200"
          }`}
        >
          <p>{campaignMessage.text}</p>
          {campaignIssuesForDownload && campaignIssuesForDownload.length > 0 && (
            <button
              type="button"
              onClick={handleDownloadCampaignIssuesCsv}
              className="mt-3 rounded border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-800 shadow-sm hover:bg-blue-50 dark:border-blue-700 dark:bg-slate-900 dark:text-blue-200 dark:hover:bg-slate-800"
            >
              Baixar CSV — {campaignIssuesForDownload.length} não incluído(s) (erro ou sem preço salvo)
            </button>
          )}
        </div>
      )}

      {updatePriceMessage && (
        <div
          className={`mb-4 rounded p-3 text-sm ${
            updatePriceMessage.type === "ok"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200"
          }`}
        >
          <p>{updatePriceMessage.text}</p>
        </div>
      )}

      {precosImportCsvModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPrecosImportCsvModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Importar CSV de preços"
        >
          <div
            className="modal-panel-scroll max-h-[min(90vh,36rem)] w-full max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-600">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Importar CSV de preços</h2>
              <button
                type="button"
                onClick={() => setPrecosImportCsvModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4 p-4 text-sm text-slate-700 dark:text-slate-300">
              <p>
                O arquivo deve estar em <strong>UTF-8</strong>, com separador <strong>;</strong> (ponto e vírgula). A
                referência de cada linha é a coluna <strong>MLB</strong>.
              </p>
              <p>
                Preencha <strong>Preço Calculado</strong> (preço em R$) ou <strong>Margem %</strong> (margem líquida alvo) em
                cada linha — pelo menos uma delas. Se ambas estiverem preenchidas, usa-se <strong>Preço Calculado</strong>.
                Também aceita o CSV exportado por esta tela (edite só MLB + Preço Calculado ou Margem %).
              </p>
              <p>
                Para margem, o anúncio precisa ter custo vinculado. Contas Mercado Líder (Gold/Platinum) incluem frete
                automaticamente; demais contas podem ativar em <strong>Configuração → Frete</strong>.
              </p>
              <div>
                <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                  Modelo mínimo (1ª linha do arquivo)
                </p>
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded border border-slate-200 bg-slate-50 p-2 text-[11px] leading-snug text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200">
                  {PRECOS_IMPORT_CSV_TEMPLATE_HEADER}
                </pre>
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-600">
                <button
                  type="button"
                  onClick={() => setPrecosImportCsvModalOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => precosImportFileInputRef.current?.click()}
                  disabled={precosImportLoading}
                  className="rounded-lg bg-brand-blue px-4 py-2 text-xs font-semibold text-white hover:bg-brand-blue-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Selecionar arquivo…
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {precosImportResult && (
        <div className="mb-6 rounded-lg border-2 border-gray-300 bg-gray-50 p-4 dark:border-slate-600 dark:bg-slate-900/40">
          <h2 className="mb-3 text-lg font-semibold">Preview da importação</h2>
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <span className="font-medium">Total de linhas: {precosImportResult.total_rows}</span>
            <span className="text-green-700 dark:text-green-400">Válidas: {precosImportResult.valid_rows}</span>
            <span className="text-red-700 dark:text-red-400">Com erro: {precosImportResult.error_rows}</span>
          </div>
          {precosImportResult.preview.length > 0 && (
            <div className="mb-4">
              <AppTable
                summary={`Preview: ${precosImportResult.valid_rows} válidas, ${precosImportResult.error_rows} com erro`}
                maxHeight="20rem"
              >
                <thead>
                  <tr>
                    <th className="p-2 font-medium">Linha</th>
                    <th className="p-2 font-medium">MLB</th>
                    <th className="p-2 font-medium">Variacao</th>
                    <th className="p-2 font-medium">Preço Calculado</th>
                    <th className="p-2 font-medium">Margem %</th>
                    <th className="p-2 font-medium">Modo</th>
                    <th className="p-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {precosImportResult.preview.map((pr) => (
                    <tr
                      key={pr.row}
                      className={`border-t border-gray-100 dark:border-slate-700 ${pr.valid ? "bg-card" : "bg-red-50 dark:bg-red-950/30"}`}
                    >
                      <td className="p-2">{pr.row}</td>
                      <td className="p-2 font-mono text-fg">{pr.item_id || "—"}</td>
                      <td className="p-2">{pr.variation_id || "—"}</td>
                      <td className="p-2">{pr.promocao?.trim() ? pr.promocao : "—"}</td>
                      <td className="p-2">{pr.margem?.trim() ? pr.margem : "—"}</td>
                      <td className="p-2">{pr.mode === "promocao" ? "Preço Calculado" : pr.mode === "margem" ? "Margem" : "—"}</td>
                      <td className="p-2">
                        {pr.valid ? (
                          <span className="rounded bg-green-200 px-2 py-0.5 text-green-800 dark:bg-green-900/50 dark:text-green-200">
                            OK
                          </span>
                        ) : (
                          <span className="rounded bg-red-200 px-2 py-0.5 text-red-800 dark:bg-red-900/50 dark:text-red-200" title={pr.error}>
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
          {(precosImportResult.errors?.length ?? 0) > 0 && (
            <div className="mb-4 max-h-40 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-sm dark:border-red-900/50 dark:bg-red-950/40">
              <p className="mb-2 font-medium text-red-800 dark:text-red-200">Erros por linha:</p>
              <ul className="list-inside list-disc space-y-1 text-red-700 dark:text-red-300">
                {(precosImportResult.errors ?? []).slice(0, 50).map((err, idx) => (
                  <li key={idx}>
                    Linha {err.row}
                    {err.field ? ` (${err.field})` : ""}: {err.message}
                  </li>
                ))}
                {(precosImportResult.errors?.length ?? 0) > 50 && (
                  <li>… e mais {(precosImportResult.errors?.length ?? 0) - 50} erros listados acima.</li>
                )}
                {precosImportResult.errors_truncated && (
                  <li className="list-none pt-1 text-xs font-medium">
                    Há mais erros no arquivo; apenas os primeiros {precosImportResult.errors?.length ?? 0} são exibidos.
                  </li>
                )}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={confirmPrecosImport}
              disabled={precosImportConfirming || precosImportResult.valid_rows === 0}
              className="rounded bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
            >
              {precosImportConfirming
                ? precosImportLoaderProgress
                  ? `Importando… ${precosImportLoaderProgress.done}/${precosImportLoaderProgress.total}`
                  : "Importando…"
                : "Confirmar importação"}
            </button>
            <button
              type="button"
              onClick={cancelPrecosImport}
              disabled={precosImportConfirming}
              className="btn btn-secondary btn-sm disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {dirtyCount > 0 && !bulkProgressLoaderActive && (
        <div className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-700">
          {dirtyCount} item(s) com alteração ainda não confirmada no campo (saia do campo com Tab ou clique fora para
          recalcular e gravar automaticamente).
        </div>
      )}

      {linkFilter === "all" &&
        accountHasLinkedProducts === false &&
        listings.length > 0 &&
        !loading && (
        <div className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-700">
          Nenhum anúncio vinculado a produtos. Para calcular o lucro, vincule seus
          anúncios aos produtos cadastrados na página{" "}
          <a href="/app/produtos" className="font-medium underline">
            Produtos
          </a>
          .
        </div>
      )}

      {salesError && (
        <div className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-800">
          Não foi possível carregar vendas (30 dias). A coluna &quot;Vendas 30d&quot; pode aparecer vazia. Verifique sua conexão ou tente novamente mais tarde.
        </div>
      )}

      {itemsWithoutListingType > 0 && (
        <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {itemsWithoutListingType} anúncio(s) sem tipo de listagem definido. 
          Sincronize novamente os anúncios na página{" "}
          <a href="/app/anuncios" className="font-medium underline">
            Anúncios
          </a>{" "}
          para obter as taxas.
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando anúncios…</p>
      ) : cacheEmpty && !loading ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
          <p className="text-sm text-amber-800">Nenhum dado no cache.</p>
          <p className="mt-1 text-xs text-amber-700">
            No menu <strong className="font-semibold">Ações</strong> acima, escolha <strong className="font-semibold">Atualizar dados</strong> para carregar os anúncios a partir do Mercado Livre.
          </p>
          <button
            type="button"
            onClick={() => void handleRefreshCache()}
            disabled={cacheRefreshing}
            className="mt-3 rounded-full border border-amber-300 bg-card px-4 py-2 text-xs font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-950/40"
          >
            {cacheRefreshing ? "Atualizando dados..." : "Atualizar dados"}
          </button>
          {refreshError && (
            <p className="mt-2 text-xs font-medium text-red-600">{refreshError}</p>
          )}
        </div>
      ) : listings.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum anúncio encontrado com os filtros selecionados.</p>
      ) : filteredListings.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nenhum anúncio nesta faixa de lucratividade. Calcule os preços ou escolha outro filtro.
        </p>
      ) : (
        <>
          <div className="pricing-table-with-sticky adminty-table-card">
          <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-700">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              <span className="font-medium text-slate-800 dark:text-slate-100">{sortedListings.length}</span>
              {" anúncio(s) nesta página · total "}
              <span className="font-medium text-slate-800 dark:text-slate-100">{total}</span>
              {total > sortedListings.length ? " (filtros aplicados no catálogo)" : ""}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <TablePageSizeSelect
                value={pageSize}
                options={PRECO_PAGE_SIZE_OPTIONS}
                onChange={(next) => {
                  setPageSize(next);
                  setPage(1);
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
            className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none"
            maxHeight="70vh"
            tableClassName="table-fixed w-max min-w-[max(100%,max-content)]"
          >
            <colgroup>
              {PRICING_COLUMNS.map((c, i) => (
                <col key={i} style={{ width: c.minWidth }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10">
              <tr>
                <th
                  data-precos-th-menu-root
                  className={`relative p-2 text-left text-xs font-semibold uppercase tracking-wide text-white/90 ${stickyColumns.has(0) ? "sticky-col" : ""}`}
                  style={stickyHeaderStyles[0]}
                >
                  <div className="flex items-center justify-between gap-1">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={
                        sortedListings.length > 0 &&
                        sortedListings.every((l) => selectedIds.has(listingSelectionKey(l)))
                      }
                      onChange={handleToggleSelectAll}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHeaderMenuColumn((c) => (c === 0 ? null : 0));
                      }}
                      className="inline-flex shrink-0 items-center rounded-sm px-0.5 hover:bg-white/10"
                      aria-expanded={headerMenuColumn === 0}
                      title="Opções da coluna"
                    >
                      <span className="text-[10px] leading-none text-white/65">▾</span>
                    </button>
                  </div>
                  {renderPricingHeaderMenu(0)}
                </th>
                {renderPricingColumnHeader(1, "Imagem")}
                {renderPricingColumnHeader(2, "MLB")}
                {renderPricingColumnHeader(3, "Título")}
                {renderPricingColumnHeader(4, "SKU")}
                {renderPricingColumnHeader(
                  5,
                  <>
                    Vendas 30d
                    {sortBy === "orders_desc" && " ↓"}
                    {sortBy === "orders_asc" && " ↑"}
                  </>,
                  {
                    align: "right",
                    sortMode: "orders",
                    title: "Pedidos pagos nos últimos 30 dias. Ordene pelo menu ▾.",
                  }
                )}
                {renderPricingColumnHeader(6, "Preço", { align: "right" })}
                {renderPricingColumnHeader(7, "Margem", {
                  align: "right",
                  title:
                    "(Lucro) ÷ Preço Calculado, com Lucro = Vai receber − custo − imposto − taxa extra − desp. fixas",
                })}
                {renderPricingColumnHeader(8, "Preço Calculado", {
                  align: "right",
                  title: "Campanhas ML exigem desconto ≥ 5% em relação ao preço do anúncio",
                })}
                {renderPricingColumnHeader(9, "Preço Final", {
                  align: "right",
                  title: priceRounding.enabled
                    ? `Centavos do Preço Calculado ajustados para ${formatTargetCentsLabel(priceRounding.targetCents)} (reais inalterados; Configuração → Preços)`
                    : "Ative o arredondamento em Configuração → Preços para ver o valor arredondado",
                })}
                {renderPricingColumnHeader(10, "Vai Receber", {
                  align: "right",
                  title: "Valor bruto (Preço Calculado) − taxa ML − frete",
                })}
                {renderPricingColumnHeader(
                  11,
                  <>
                    Lucro
                    {sortBy === "profit_desc" && " ↓"}
                    {sortBy === "profit_asc" && " ↑"}
                  </>,
                  { align: "right", sortMode: "profit" }
                )}
                {renderPricingColumnHeader(12, "Taxa ML", {
                  align: "right",
                  title:
                    "Comissão ML em R$ sobre o Preço Calculado. Abaixo: mesmo percentual (taxa ÷ Preço Calculado) ou referência por categoria se ainda não calculou.",
                })}
                {renderPricingColumnHeader(13, "Frete", { align: "right" })}
                {renderPricingColumnHeader(
                  14,
                  <>
                    Custo
                    {sortBy === "cost_desc" && " ↓"}
                    {sortBy === "cost_asc" && " ↑"}
                  </>,
                  { align: "right", sortMode: "cost" }
                )}
                {renderPricingColumnHeader(15, "Imposto", { align: "right", title: "Imposto sobre o preço" })}
                {renderPricingColumnHeader(16, "Taxa Extra", { align: "right", title: "Taxa extra sobre o preço" })}
                {renderPricingColumnHeader(17, "Desp. Fixas", {
                  align: "right",
                  title: "Despesas fixas em R$ (cadastrado no produto)",
                })}
                {renderPricingColumnHeader(18, "Promo ML", {
                  align: "right",
                  title:
                    "Campanhas/promoções ativas (cache de Promoções, sem chamada à API do ML no refresh de Preços). Passe o mouse no badge para detalhes.",
                })}
                {renderPricingColumnHeader(19, "Competitividade", {
                  align: "right",
                  title: "Competitividade no Mercado Livre (sugestão / faixa de preço)",
                })}
                {renderPricingColumnHeader(20, "Link")}
              </tr>
            </thead>
            <tbody key={tableFilterEpoch}>
              {sortedListings.map((listing) => {
                const profit =
                  listing.calculated && listing.cost_price != null
                    ? listing.calculated.net_amount - listing.cost_price
                    : null;
                const profitPercent =
                  profit != null && listing.new_price > 0
                    ? (profit / listing.new_price) * 100
                    : null;

                const mlFeeSharePct =
                  listing.calculating
                    ? null
                    : listing.calculated && listing.calculated.price > 0
                      ? (listing.calculated.fee / listing.calculated.price) * 100
                      : listing.reference_fee_percent != null &&
                          Number.isFinite(Number(listing.reference_fee_percent))
                        ? Number(listing.reference_fee_percent)
                        : null;
                const mlFeeShareIsReference =
                  !listing.calculating &&
                  !listing.calculated &&
                  mlFeeSharePct != null;

                const isSelected = selectedIds.has(listingSelectionKey(listing));

                return (
                  <tr
                    key={listingSelectionKey(listing)}
                    className="table-body-row"
                  >
                    <td
                      className={`p-2 text-center ${stickyColumns.has(0) ? "sticky-col" : ""}`}
                      style={stickyBodyStyles[0]}
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={isSelected}
                        onMouseDown={(e) => {
                          rowSelectShiftRef.current = e.shiftKey;
                        }}
                        onChange={(e) => {
                          handleRowSelectChange(
                            listingSelectionKey(listing),
                            rowSelectShiftRef.current,
                            e.target.checked
                          );
                        }}
                      />
                    </td>
                    <td
                      className={`p-2 ${stickyColumns.has(1) ? "sticky-col" : ""}`}
                      style={stickyBodyStyles[1]}
                    >
                      {listing.thumbnail ? (
                        <img
                          src={listing.thumbnail.replace(/^http:/, "https:")}
                          alt=""
                          className="h-10 w-10 rounded-lg border border-slate-100 bg-slate-50 object-contain"
                        />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td
                      className={`p-2 ${stickyColumns.has(2) ? "sticky-col" : ""}`}
                      style={stickyBodyStyles[2]}
                    >
                      <div className="flex items-center gap-1">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => handleCopyToClipboard(listing.item_id, `mlb-${listing.id}-${listing.variation_id ?? "n"}`)}
                          onKeyDown={(e) => e.key === "Enter" && handleCopyToClipboard(listing.item_id, `mlb-${listing.id}-${listing.variation_id ?? "n"}`)}
                          title="Clique para copiar"
                          className="pricing-cell-chip font-mono text-xs"
                        >
                          {copiedCell === `mlb-${listing.id}-${listing.variation_id ?? "n"}` ? (
                            <span className="text-xs font-semibold text-emerald-600">Copiado!</span>
                          ) : (
                            listing.item_id
                          )}
                          {listing.variation_id && (
                            <span className="block text-fg-muted">var: {listing.variation_id}</span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRefreshItem(listing.item_id); }}
                          disabled={refreshingItemId === listing.item_id}
                          title="Atualizar este item no cache"
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:text-slate-300 disabled:opacity-50"
                        >
                          {refreshingItemId === listing.item_id ? (
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                          ) : (
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </td>
                    <td
                      className={`p-2 text-sm ${stickyColumns.has(3) ? "sticky-col" : ""}`}
                      style={stickyBodyStyles[3]}
                      title={listing.title ?? ""}
                    >
                      <span className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-50">
                        {listing.title ?? "—"}
                      </span>
                    </td>
                    <td
                      className={`p-2 font-mono text-xs text-slate-700 dark:text-slate-200 ${stickyColumns.has(4) ? "sticky-col" : ""}`}
                      style={stickyBodyStyles[4]}
                    >
                      {listing.sku ? (
                        (() => {
                          const { primary, extraCount } = skuDisplayParts(listing.sku);
                          if (!primary) return <span className="text-fg-muted">—</span>;
                          const linked = Boolean(listing.product_id);
                          return (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => handleCopyToClipboard(primary, `sku-${listing.id}-${listing.variation_id ?? "n"}`)}
                          onKeyDown={(e) => e.key === "Enter" && handleCopyToClipboard(primary, `sku-${listing.id}-${listing.variation_id ?? "n"}`)}
                          title={listing.sku}
                          className="pricing-cell-chip inline-flex items-center gap-1 text-left"
                        >
                          {copiedCell === `sku-${listing.id}-${listing.variation_id ?? "n"}` ? (
                            <span className="text-xs font-semibold text-emerald-600">Copiado!</span>
                          ) : (
                            <>
                              <span>{primary}</span>
                              {extraCount > 0 && (
                                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                                  +{extraCount}
                                </span>
                              )}
                              <span
                                title={linked ? "Vinculado a produto" : "Sem vínculo com produto"}
                                className="ml-0.5 inline-flex"
                              >
                                <LinkStatusIcon linked={linked} />
                              </span>
                            </>
                          )}
                        </span>
                          );
                        })()
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td
                      className={`p-2 text-right text-sm tabular-nums ${stickyColumns.has(5) ? "sticky-col" : ""}`}
                      style={stickyBodyStyles[5]}
                      title={
                        ordersData[listing.item_id] != null
                          ? `${ordersData[listing.item_id]} pedido(s) pago(s) em 30 dias`
                          : "Número de pedidos pagos que contêm este item."
                      }
                    >
                      {ordersData[listing.item_id] != null ? (
                        ordersData[listing.item_id]
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right text-sm font-medium ${stickyColumns.has(6) ? "sticky-col" : ""}`} style={stickyBodyStyles[6]}>
                      R$ {formatBRL(listing.current_price)}
                    </td>
                    <td className={`p-2 text-right ${stickyColumns.has(7) ? "sticky-col" : ""}`} style={stickyBodyStyles[7]}>
                      {listing.calculating ? (
                        <span className="text-fg-muted">…</span>
                      ) : (
                        <MarginInput
                          valuePercent={getProfitPercent(listing)}
                          disabled={
                            listing.cost_price == null ||
                            !listing.listing_type_id ||
                            !listing.category_id
                          }
                          dirty={listing.dirty}
                          onCommit={(pct) => void handleMarginCommit(listing, pct)}
                        />
                      )}
                    </td>
                    <td className={`p-2 ${stickyColumns.has(8) ? "sticky-col" : ""}`} style={stickyBodyStyles[8]}>
                      <div className="flex flex-col items-end gap-0.5">
                        <PriceInput
                          value={listing.new_price}
                          onChange={(newValue) =>
                            handlePriceChange(
                              listing.id,
                              listing.variation_id,
                              String(newValue)
                            )
                          }
                          onCommit={(committed) => void handlePriceRowCommit(listing, committed)}
                          dirty={listing.dirty}
                        />
                        {listing.current_price > 0 && listing.new_price > 0 && !meetsMlMinCampaignDiscount(listing) && (
                          <button
                            type="button"
                            onClick={() => void handleApplyMinDiscount(listing)}
                            disabled={listing.calculating}
                            className="text-xs text-amber-600 underline hover:text-amber-700 disabled:opacity-50 whitespace-nowrap"
                            title="Clique para ajustar ao desconto mínimo de 5% (preço calculado = 95% do preço ML)"
                          >
                            Ajustar para 5%
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={`p-2 text-right text-sm font-medium ${stickyColumns.has(9) ? "sticky-col" : ""}`} style={stickyBodyStyles[9]}>
                      {listing.new_price > 0 ? (
                        (() => {
                          const finalPrice = applyPriceRounding(listing.new_price, priceRounding);
                          const rounded =
                            priceRounding.enabled &&
                            Math.abs(finalPrice - listing.new_price) >= 0.005;
                          return (
                            <span
                              className={rounded ? "text-indigo-700 dark:text-indigo-300" : "text-fg"}
                              title={
                                rounded
                                  ? `Arredondado de R$ ${formatBRL(listing.new_price)} (Configuração → Preços)`
                                  : priceRounding.enabled
                                    ? "Igual ao Preço Calculado"
                                    : "Arredondamento desativado em Configuração → Preços"
                              }
                            >
                              R$ {formatBRL(finalPrice)}
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right text-sm font-semibold ${stickyColumns.has(10) ? "sticky-col" : ""}`} style={stickyBodyStyles[10]}>
                      {listing.calculating ? (
                        <span className="text-fg-muted">…</span>
                      ) : listing.calculated ? (
                        <span className="text-green-700">
                          R$ {formatBRL(listing.calculated.vai_receber)}
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(11) ? "sticky-col" : ""}`} style={stickyBodyStyles[11]}>
                      {listing.calculating ? (
                        <span className="text-fg-muted">…</span>
                      ) : profit != null ? (
                        <div className="flex flex-col items-end">
                          <span
                            className={
                              profit >= 0 ? "text-green-600" : "text-red-600"
                            }
                          >
                            R$ {formatBRL(profit)}
                          </span>
                          {profitPercent != null && (
                            <span
                              className={`text-xs ${
                                profitPercent >= 0
                                  ? "text-green-500"
                                  : "text-red-500"
                              }`}
                            >
                              {profitPercent >= 0 ? "+" : ""}
                              {profitPercent.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(12) ? "sticky-col" : ""}`} style={stickyBodyStyles[12]}>
                      {listing.calculating ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-fg-muted">…</span>
                          <span className="text-xs text-fg-muted">…</span>
                        </div>
                      ) : listing.calculated ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-amber-700">
                            R$ {formatBRL(listing.calculated.fee)}
                          </span>
                          {mlFeeSharePct != null && (
                            <span
                              className={`text-xs tabular-nums ${
                                mlFeeShareIsReference
                                  ? "text-slate-400 dark:text-slate-500"
                                  : "text-amber-600 dark:text-amber-500"
                              }`}
                              title={
                                mlFeeShareIsReference
                                  ? "Referência por categoria/tipo (última sync)"
                                  : "Taxa ML ÷ Preço Calculado (último cálculo)"
                              }
                            >
                              {mlFeeSharePct.toFixed(1).replace(".", ",")}%
                            </span>
                          )}
                        </div>
                      ) : !listing.listing_type_id ? (
                        <span className="text-red-400" title="Tipo de anúncio não disponível">
                          N/D
                        </span>
                      ) : (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-fg-muted">—</span>
                          {mlFeeSharePct != null && mlFeeShareIsReference ? (
                            <span
                              className="text-xs tabular-nums text-slate-400 dark:text-slate-500"
                              title="Referência de taxa por categoria/tipo (última sincronização). Calcule ou edite o Preço Calculado para ver o valor em R$."
                            >
                              {mlFeeSharePct.toFixed(1).replace(".", ",")}%
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(13) ? "sticky-col" : ""}`} style={stickyBodyStyles[13]}>
                      {listing.calculating ? (
                        <span className="text-fg-muted">…</span>
                      ) : listing.calculated ? (
                        <span
                          className={
                            listing.calculated.shipping_cost > 0
                              ? "text-red-600"
                              : "text-fg-muted"
                          }
                        >
                          {listing.calculated.shipping_cost > 0
                            ? `R$ ${formatBRL(listing.calculated.shipping_cost)}`
                            : "—"}
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(14) ? "sticky-col" : ""}`} style={stickyBodyStyles[14]}>
                      {listing.cost_price != null ? (
                        <span className="text-fg">
                          R$ {formatBRL(listing.cost_price)}
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(15) ? "sticky-col" : ""}`} style={stickyBodyStyles[15]}>
                      {listing.calculating ? (
                        <span className="text-fg-muted">…</span>
                      ) : listing.calculated ? (
                        <span
                          className={
                            listing.calculated.tax_amount > 0
                              ? "text-orange-600"
                              : "text-fg-muted"
                          }
                          title={listing.tax_percent ? `${listing.tax_percent}%` : undefined}
                        >
                          {listing.calculated.tax_amount > 0
                            ? `R$ ${formatBRL(listing.calculated.tax_amount)}`
                            : "—"}
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(16) ? "sticky-col" : ""}`} style={stickyBodyStyles[16]}>
                      {listing.calculating ? (
                        <span className="text-fg-muted">…</span>
                      ) : listing.calculated ? (
                        <span
                          className={
                            listing.calculated.extra_fee_amount > 0
                              ? "text-purple-600"
                              : "text-fg-muted"
                          }
                          title={listing.extra_fee_percent ? `${listing.extra_fee_percent}%` : undefined}
                        >
                          {listing.calculated.extra_fee_amount > 0
                            ? `R$ ${formatBRL(listing.calculated.extra_fee_amount)}`
                            : "—"}
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(17) ? "sticky-col" : ""}`} style={stickyBodyStyles[17]}>
                      {listing.calculating ? (
                        <span className="text-fg-muted">…</span>
                      ) : listing.calculated ? (
                        <span
                          className={
                            listing.calculated.fixed_expenses_amount > 0
                              ? "text-indigo-600"
                              : "text-fg-muted"
                          }
                          title={listing.fixed_expenses != null ? `R$ ${formatBRL(listing.fixed_expenses)}` : undefined}
                        >
                          {listing.calculated.fixed_expenses_amount > 0
                            ? `R$ ${formatBRL(listing.calculated.fixed_expenses_amount)}`
                            : "—"}
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right ${stickyColumns.has(18) ? "sticky-col" : ""}`} style={stickyBodyStyles[18]}>
                      <MlActivePromotionsCell text={listing.ml_active_promotions} />
                    </td>
                    <td className={`p-2 text-right ${stickyColumns.has(19) ? "sticky-col" : ""}`} style={stickyBodyStyles[19]}>
                      {(() => {
                        const ref = priceRefsByRow[priceRefRowKey(listing.item_id, listing.variation_id)];
                        const st = ref?.status ?? "none";
                        const { label, className } = competitivenessBadge(st);
                        const tip = [
                          ref?.explanation,
                          ref?.updated_at ? `Atualizado: ${new Date(ref.updated_at).toLocaleString("pt-BR")}` : null,
                        ]
                          .filter(Boolean)
                          .join("\n");
                        return (
                          <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${className}`} title={tip || undefined}>
                            {label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className={`p-2 ${stickyColumns.has(20) ? "sticky-col" : ""}`} style={stickyBodyStyles[20]}>
                      {listing.permalink ? (
                        <a
                          href={listing.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Ver no Mercado Livre"
                          className="inline-flex items-center justify-center rounded-full bg-primary/10 p-1.5 text-primary hover:bg-primary/15"
                        >
                          <MLIcon className="h-5 w-5" />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </AppTable>
          </div>
        </>
      )}
        </div>
        )}
      </div>

    </div>
  );
}

export default function PrecosPage() {
  return (
    <OnboardingGate required="catalog">
      <PrecosPageContent />
    </OnboardingGate>
  );
}
