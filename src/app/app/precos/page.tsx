"use client";

import { useCallback, useEffect, useState, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { AppTable } from "@/components/AppTable";
import { OnboardingGate } from "@/components/OnboardingGate";
import { SmartLoaderOverlay } from "@/components/SmartLoaderOverlay";
import { PRICING_CALCULATE_CLIENT_BATCH_SIZE } from "@/lib/pricing/calculate-limits";
import { calculateFullPricing as computeFullPricingBreakdown, type FullPricingBreakdown } from "@/lib/pricing/full-net";
import {
  sanitizeMlSellerCampaignNameInput,
  isValidMlSellerCampaignName,
  ML_SELLER_CAMPAIGN_NAME_HINT,
} from "@/lib/mercadolivre/campaign-name";
import { splitMlActivePromotionsCell } from "@/lib/mercadolivre/seller-promotions-item";

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
      : "Nenhuma promoção ativa no cache (última atualização). Passe o mouse para ver o detalhe quando houver campanhas.";
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

/** Mercado Livre exige desconto mínimo de 5% na promoção: valor em Promoção deve ser ≤ 95% do preço. */
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

/** Resposta por item em POST /api/mercadolivre/seller-campaigns */
type SellerCampaignItemResult =
  | { item_id: string; variation_id: number | null; status: "ok"; price: number }
  | { item_id: string; variation_id: number | null; status: "skipped_no_planned_price" }
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

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 8v5l3 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
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

const PRICING_COLUMNS: { label: string; minWidth: number }[] = [
  { label: "Seleção", minWidth: 44 },
  { label: "Imagem", minWidth: 52 },
  { label: "MLB", minWidth: 100 },
  /** Largura da coluna (colgroup + sticky `left`); 2 linhas no corpo */
  { label: "Título", minWidth: 300 },
  /** SKU costuma ser longo — evita truncar com col estreita */
  { label: "SKU", minWidth: 300 },
  { label: "Vendas 30d", minWidth: 88 },
  { label: "Custo", minWidth: 80 },
  { label: "Promo ML", minWidth: 120 },
  { label: "Preço", minWidth: 90 },
  { label: "Competitividade", minWidth: 110 },
  { label: "Margem", minWidth: 76 },
  { label: "Promoção", minWidth: 100 },
  { label: "Vai Receber", minWidth: 95 },
  { label: "Lucro", minWidth: 95 },
  { label: "Taxa ML", minWidth: 72 },
  { label: "Frete", minWidth: 72 },
  { label: "Imposto", minWidth: 80 },
  { label: "Taxa Extra", minWidth: 88 },
  { label: "Desp. Fixas", minWidth: 88 },
  { label: "Link", minWidth: 88 },
];

const PRICOS_STICKY_STORAGE_KEY = "escalapreco.precos.pinnedColumns.v4";
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
    const v3raw = localStorage.getItem(PRICOS_STICKY_V3_KEY);
    if (v3raw) {
      const arr = JSON.parse(v3raw) as unknown;
      if (Array.isArray(arr)) {
        const n = PRICING_COLUMNS.length;
        const nums = arr.filter(
          (x): x is number =>
            typeof x === "number" && Number.isInteger(x) && x >= 0 && x < n
        );
        const migrated = swapPinnedPromoAndPriceColumnIndices(nums).filter((x) => x >= 0 && x < n);
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
        const migrated = swapPinnedPromoAndPriceColumnIndices(
          bumpStickyIndicesAfterPromoMlColumn(nums)
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
      const withPromoCol = swapPinnedPromoAndPriceColumnIndices(
        bumpStickyIndicesAfterPromoMlColumn(Array.from(migratedV2))
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
      className={`w-24 rounded border px-2 py-1 text-right text-sm ${
        dirty ? "border-amber-400 bg-amber-50" : "border-gray-300"
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
        title="Margem líquida sobre o preço de promoção. Ao confirmar, a promoção é ajustada pela calculadora (taxas ML, frete, impostos)."
        className={`w-[4.25rem] rounded border px-1.5 py-1 text-right text-sm tabular-nums ${
          dirty ? "border-amber-400 bg-amber-50" : "border-gray-300 dark:border-slate-600"
        }`}
      />
      <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">%</span>
    </div>
  );
}

async function fetchCalculatedPricingAtPrice(
  listing: ListingWithPricing,
  price: number,
  isMercadoLider: boolean
): Promise<CalculatedPricing | null> {
  if (!listing.listing_type_id || !listing.category_id || !Number.isFinite(price) || price <= 0) return null;
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
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.[0] as { price: number; fee: number; shipping_cost: number } | undefined;
    if (!result) return null;
    return computeFullPricingBreakdown(listing.tax_percent, listing.extra_fee_percent, listing.fixed_expenses, result);
  } catch {
    return null;
  }
}

function achievedNetMarginPercent(
  listing: Pick<ListingWithPricing, "cost_price">,
  price: number,
  calc: CalculatedPricing
): number {
  const C = listing.cost_price!;
  return ((calc.net_amount - C) / price) * 100;
}

/** Busca binária no preço até a margem líquida (líquido − custo) / preço ≈ alvo. */
async function solvePriceForTargetNetMarginPercent(
  listing: ListingWithPricing,
  targetPct: number,
  isMercadoLider: boolean
): Promise<{ price: number; calculated: CalculatedPricing } | null> {
  if (listing.cost_price == null) return null;

  const marginAtPrice = async (p: number): Promise<number | null> => {
    const calc = await fetchCalculatedPricingAtPrice(listing, p, isMercadoLider);
    if (!calc) return null;
    return achievedNetMarginPercent(listing, p, calc);
  };

  let low = Math.max(0.01, listing.cost_price * 0.01);
  let high = Math.max(
    listing.new_price > 0 ? listing.new_price * 2 : 0,
    listing.current_price * 2,
    listing.cost_price * 3,
    50
  );

  let mHigh = await marginAtPrice(high);
  if (mHigh == null) return null;
  let expand = 0;
  while (mHigh < targetPct && high < 5_000_000 && expand < 28) {
    high = Math.min(high * 1.5, 5_000_000);
    mHigh = await marginAtPrice(high);
    if (mHigh == null) return null;
    expand++;
  }

  let mLow = await marginAtPrice(low);
  if (mLow == null) return null;
  expand = 0;
  while (mLow > targetPct && low > 0.01 && expand < 28) {
    low = Math.max(0.01, low * 0.85);
    mLow = await marginAtPrice(low);
    if (mLow == null) return null;
    expand++;
  }

  let best: { price: number; calculated: CalculatedPricing } | null = null;
  let bestErr = Infinity;

  for (let i = 0; i < 28; i++) {
    const mid = (low + high) / 2;
    const calc = await fetchCalculatedPricingAtPrice(listing, mid, isMercadoLider);
    if (!calc) break;
    const m = achievedNetMarginPercent(listing, mid, calc);
    const err = Math.abs(m - targetPct);
    if (err < bestErr) {
      bestErr = err;
      best = { price: mid, calculated: calc };
    }
    if (err < 0.02) {
      return { price: mid, calculated: calc };
    }
    if (m < targetPct) low = mid;
    else high = mid;
  }

  return best;
}

const MAX_PRICING_CALCULATE_BATCH = PRICING_CALCULATE_CLIENT_BATCH_SIZE;

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
};

type PricingCalculateResultRow = {
  item_id: string;
  variation_id: number | null;
  price: number;
  fee: number;
  shipping_cost: number;
};

function findPricingResultForListing(
  results: PricingCalculateResultRow[],
  listing: Pick<ListingWithPricing, "item_id" | "variation_id">
): PricingCalculateResultRow | undefined {
  return results.find(
    (r) => r.item_id === listing.item_id && (r.variation_id ?? null) === (listing.variation_id ?? null)
  );
}

/** Chave única para checkbox / ações em massa (UUID do cache ou MLB + variação). */
function listingSelectionKey(l: Pick<PricingListing, "id" | "item_id" | "variation_id">): string {
  if (l.id) return l.id;
  return `${l.item_id}:${l.variation_id ?? "n"}`;
}

/**
 * Envia o cálculo em lotes de até 100 itens (limite da API), em sequência, e concatena resultados.
 */
async function fetchPricingCalculateBatches(
  items: PricingCalculatePayloadItem[],
  isMercadoLider: boolean
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
  for (let i = 0; i < items.length; i += step) {
    const batch = items.slice(i, i + step);
    if (batch.length === 0) continue;
    try {
      const res = await fetch("/api/pricing/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: batch,
          is_mercado_lider: isMercadoLider,
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
  }
  return { results, errors };
}

function PrecosHelpContent() {
  return (
    <div className="space-y-4 text-sm text-fg">
      <h2 className="text-lg font-semibold text-fg-strong">Como funciona a Calculadora de Preços</h2>
      <div className="space-y-4">
          <section>
            <h3 className="mb-2 font-medium text-fg-strong">Objetivo</h3>
            <p>
              Esta ferramenta permite simular preços de venda em massa para seus anúncios do Mercado Livre,
              calculando automaticamente as taxas e o valor líquido que você receberá.
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-fg-strong">Colunas da tabela</h3>
            <ul className="list-inside list-disc space-y-1">
              <li><strong>SKU:</strong> Código do produto vinculado ao anúncio</li>
              <li><strong>Vendas 30d:</strong> Número de pedidos pagos que contêm o item nos últimos 30 dias. Clique no cabeçalho para ordenar.</li>
              <li><strong>Custo:</strong> Preço de custo do produto (cadastrado em Produtos)</li>
              <li><strong>Preço:</strong> Valor atual do anúncio no Mercado Livre</li>
              <li><strong>Competitividade:</strong> Indicador da referência de preço do ML (sugestão / faixa), ao lado do preço. No menu <strong>Ações</strong>, use <strong>Atualizar referência</strong> para buscar dados novos sem refazer o cache de anúncios.</li>
              <li><strong>Margem:</strong> Percentual (lucro líquido) ÷ preço da coluna Promoção — o mesmo lucro da coluna Lucro. Editável: ao confirmar, recalcula a promoção. Sem custo cadastrado fica indisponível.</li>
              <li><strong>Promoção:</strong> Valor bruto de referência (planned_price); campo editável — usado como base para taxa ML, frete, impostos e Vai receber</li>
              <li><strong>Vai Receber:</strong> valor bruto (Promoção) − taxa ML − frete</li>
              <li><strong>Lucro:</strong> Vai receber − custo − imposto − taxa extra − desp. fixas</li>
              <li><strong>Taxa ML:</strong> Taxa de comissão do Mercado Livre calculada sobre o preço</li>
              <li><strong>Frete:</strong> Custo de frete (apenas para contas Mercado Líder)</li>
              <li><strong>Imposto:</strong> Valor do imposto calculado sobre o preço (% cadastrado no produto)</li>
              <li><strong>Taxa Extra:</strong> Taxa extra calculada sobre o preço (% cadastrado no produto)</li>
              <li><strong>Desp. Fixas:</strong> Despesas fixas em R$ (valor cadastrado no produto, descontado do líquido)</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-fg-strong">Como usar</h3>
            <ol className="list-inside list-decimal space-y-1">
              <li>Os anúncios são carregados automaticamente ao abrir a página</li>
              <li>Edite &quot;Promoção&quot; ou &quot;Margem&quot; (com custo e tipo de anúncio): em ambos, confirme com Enter ou clique fora para recalcular</li>
              <li>No menu <strong>Ações</strong>, use <strong>Calcular Todos</strong> para recalcular taxas e valores líquidos de todas as linhas de uma vez</li>
              <li>
                Ao confirmar a &quot;Promoção&quot; ou a &quot;Margem&quot; (Enter ou ao sair do campo), ou ao usar ações em massa, o
                preço planejado é gravado automaticamente (MLB + SKU)
              </li>
            </ol>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-fg-strong">Mercado Líder</h3>
            <p>
              Se sua conta é Mercado Líder, marque a opção para incluir o custo de frete no cálculo.
              O frete usa o maior entre peso real e peso volumétrico (altura × largura × comprimento ÷ 6000), como no Mercado Livre.
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-fg-strong">Filtros (busca geral)</h3>
            <ul className="list-inside list-disc space-y-1">
              <li><strong>Status:</strong> Filtre por anúncios ativos, pausados ou encerrados</li>
              <li>
                <strong>Vínculo com produto:</strong> pode filtrar só anúncios vinculados a um produto (custo/SKU) ou só os
                não vinculados para corrigir depois
              </li>
              <li><strong>Busca:</strong> Pesquise por título ou código MLB</li>
              <li><strong>Só com vendas (30d):</strong> Exibe apenas anúncios com pelo menos 1 venda nos últimos 30 dias</li>
              <li><strong>Lucratividade:</strong> Filtra em até 500 anúncios carregados (busca geral na amostra)</li>
            </ul>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-fg-strong">Imposto, Taxa Extra e Desp. Fixas</h3>
            <p className="mb-2">
              Imposto e taxa extra (percentuais) e despesas fixas (valor em R$) são cadastrados na página de Produtos.
              Imposto e taxa extra são calculados sobre o valor bruto (coluna Promoção); no <strong>Lucro</strong>, custo, imposto, taxa extra e desp. fixas são descontados após o <strong>Vai receber</strong>.
            </p>
            <p className="text-fg">
              Exemplo: Produto com 10% de imposto, 5% de taxa extra e R$ 2,00 de desp. fixas vendido a R$ 100,00:
              <br />Imposto = R$ 10,00 | Taxa Extra = R$ 5,00 | Desp. Fixas = R$ 2,00
            </p>
          </section>

          <section>
            <h3 className="mb-2 font-medium text-fg-strong">Observações</h3>
            <ul className="list-inside list-disc space-y-1">
              <li>
                Anúncios com variações aparecem uma linha por MLB (preço do anúncio no ML é único até o suporte
                pleno a preço por variação via User Product). Custo, impostos e SKU vêm dos produtos vinculados às
                variações (vários SKUs podem aparecer resumidos na mesma linha).
              </li>
              <li>Anúncios sem tipo de listagem (N/D) precisam ser sincronizados novamente</li>
              <li>Para ter o custo, vincule o anúncio a um produto na página de Produtos</li>
              <li>Imposto, taxa extra e desp. fixas são considerados apenas se cadastrados no produto vinculado</li>
              <li>Os preços salvos ficam vinculados ao MLB e ao SKU; ao reabrir a página, o valor em &quot;Promoção&quot; virá do último preço planejado salvo</li>
              <li>Esta ferramenta não altera os preços no Mercado Livre; ela apenas calcula e guarda o preço planejado</li>
            </ul>
          </section>
      </div>
    </div>
  );
}

function PrecosPageContent() {
  const [listings, setListings] = useState<ListingWithPricing[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [skuFilter, setSkuFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  /** Filtro por vínculo com produto no cache */
  const [linkFilter, setLinkFilter] = useState<"all" | "linked" | "unlinked">("all");
  const [calculating, setCalculating] = useState(false);
  const [isMercadoLider, setIsMercadoLider] = useState(false);
  const [reputationLoading, setReputationLoading] = useState(true);
  const [precosTab, setPrecosTab] = useState<"calculadora" | "como-funciona">("calculadora");
  const [saveMessage, setSaveMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  /** Filtro por % de lucro: "" = todos, "high" = >20%, "medium" = 10-20%, "low" = 0-10%, "negative" = ≤0% */
  const [profitFilter, setProfitFilter] = useState<"" | "high" | "medium" | "low" | "negative">("");
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
  const [refreshingItemId, setRefreshingItemId] = useState<string | null>(null);
  /** Ordenação: "" = padrão; orders_* = por quantidade de vendas (pedidos pagos) nos últimos 30 dias */
  const [sortBy, setSortBy] = useState<"" | "orders_desc" | "orders_asc">("");
  /** Mostrar somente itens com vendas nos últimos 30 dias */
  const [onlyWithSales30d, setOnlyWithSales30d] = useState(false);
  /** Promoção (planejada) igual ao preço atual do anúncio — sem desconto em relação ao ML */
  const [semPromocao, setSemPromocao] = useState(false);
  /** Promoção acima de 95% do preço (desconto menor que 5%) — não atendem ao mínimo da promoção ML */
  const [foraDescontoMin5Ml, setForaDescontoMin5Ml] = useState(false);
  /** Sem campanhas/promoções ativas no ML (seller-promotions) no último refresh do cache */
  const [semPromoMlAtiva, setSemPromoMlAtiva] = useState(false);
  /** Com filtros no cliente: carregar até 2000 itens de uma vez (em vez de 500) */
  const [loadAllResults, setLoadAllResults] = useState(false);
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
  /** Modal de filtros (padrão Adminty) */
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  const [optionsMenuOpen, setOptionsMenuOpen] = useState(false);
  const optionsMenuRef = useRef<HTMLDivElement>(null);
  const [lastUpdatedInfoOpen, setLastUpdatedInfoOpen] = useState(false);
  const lastUpdatedInfoRef = useRef<HTMLDivElement>(null);
  /** Índices das colunas congeladas (0-based). Ordem dos congelados = ordem na tabela. Persistido em localStorage após hidratação. */
  const [stickyColumns, setStickyColumns] = useState<Set<number>>(() => new Set());
  const [stickyHydrated, setStickyHydrated] = useState(false);
  /** Menu ▾ no cabeçalho da coluna (congelar / ordenar vendas), padrão Anúncios */
  const [headerMenuColumn, setHeaderMenuColumn] = useState<number | null>(null);
  /** Menu suspenso de ações em massa (linhas selecionadas) */
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false);
  const bulkActionsRef = useRef<HTMLDivElement | null>(null);
  /** Menu Atualizar dados / referência / Calcular todos */
  const [globalActionsOpen, setGlobalActionsOpen] = useState(false);
  const globalActionsRef = useRef<HTMLDivElement | null>(null);
  const bulkDiscountBusyRef = useRef(false);
  const [bulkDiscountModalOpen, setBulkDiscountModalOpen] = useState(false);
  const [bulkDiscountPercentInput, setBulkDiscountPercentInput] = useState(String(ML_MIN_CAMPAIGN_DISCOUNT_PERCENT));
  /** Modal: definir margem líquida (%) nos anúncios selecionados */
  const [bulkMarginModalOpen, setBulkMarginModalOpen] = useState(false);
  const [bulkMarginPercentInput, setBulkMarginPercentInput] = useState("");
  const bulkMarginBusyRef = useRef(false);
  const bulkRestoreOriginalBusyRef = useRef(false);
  const campaignMessageDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadReputation = useCallback(async () => {
    setReputationLoading(true);
    try {
      const res = await fetch("/api/mercadolivre/reputation");
      if (res.ok) {
        const data = (await res.json()) as ReputationData;
        const powerSeller = data.reputation?.power_seller_status;
        setIsMercadoLider(powerSeller === "gold" || powerSeller === "platinum");
      }
    } catch {
      // ignore
    } finally {
      setReputationLoading(false);
    }
  }, []);

  /** Com filtro de lucro, "só com vendas 30d", "sem promoção" ou "fora do mín. 5% ML" ativo, busca mais itens e aplica filtros no cliente (paginação no cliente) */
  const clientSideFiltering = !!(profitFilter || onlyWithSales30d || semPromocao || foraDescontoMin5Ml || semPromoMlAtiva);
  const MAX_CLIENT_SIDE_LOAD = 10000;
  const DEFAULT_CLIENT_SIDE_LOAD = 2000;
  const limitForRequest = clientSideFiltering
    ? (loadAllResults ? MAX_CLIENT_SIDE_LOAD : DEFAULT_CLIENT_SIDE_LOAD)
    : pageSize;
  const pageForRequest = clientSideFiltering ? 1 : page;

  const loadListings = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(pageForRequest),
      limit: String(limitForRequest),
    });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (linkFilter === "linked") params.set("linked", "1");
    if (linkFilter === "unlinked") params.set("linked", "0");
    if (sortBy === "orders_desc" || sortBy === "orders_asc") params.set("order_by", sortBy);
    if (skuFilter) params.set("sku", skuFilter);
    if (onlyWithSales30d) params.set("only_with_sales", "1");

    try {
      const [listingsRes, plannedRes] = await Promise.all([
        fetch(`/api/pricing/listings?${params}`),
        fetch("/api/pricing/planned-prices"),
      ]);

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
      if (plannedRes.ok) {
        const plannedData = await plannedRes.json();
        const plannedList = plannedData.prices ?? [];
        for (const p of plannedList) {
          const key = `${p.item_id}:${p.variation_id ?? "n"}`;
          plannedMap.set(key, p.planned_price);
        }
      }

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
            calculated = computeFullPricingBreakdown(item.tax_percent, item.extra_fee_percent, item.fixed_expenses, {
              price: apiItem.calculated_price,
              fee: apiItem.calculated_fee,
              shipping_cost: apiItem.calculated_shipping_cost,
            });
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
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [pageForRequest, limitForRequest, search, statusFilter, linkFilter, sortBy, skuFilter, onlyWithSales30d]);

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
        text: data.error ?? "Não foi possível iniciar a atualização da referência de preço.",
      });
    } catch {
      setSaveMessage({
        type: "error",
        text: "Erro de conexão ao atualizar referência de preço.",
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

  /** Ao mudar filtros do servidor (ou sair do modo cliente), voltar a carregar só 500 quando em modo cliente */
  useEffect(() => {
    if (clientSideFiltering) setLoadAllResults(false);
  }, [clientSideFiltering, search, statusFilter, linkFilter, sortBy, skuFilter]);

  useEffect(() => {
    loadReputation();
  }, [loadReputation]);

  useEffect(() => {
    loadListings();
  }, [loadListings]);

  useEffect(() => {
    setPage(1);
  }, [profitFilter, onlyWithSales30d, semPromocao, foraDescontoMin5Ml, semPromoMlAtiva]);

  /** Dados sempre vêm do cache (listings já inclui orders_30d). Não busca vendas em separado. */

  const doCalculate = useCallback(
    async (items: ListingWithPricing[], mercadoLider: boolean) => {
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
        }));

      if (itemsToCalculate.length === 0) return;

      try {
        const { results } = await fetchPricingCalculateBatches(itemsToCalculate, mercadoLider);

        setListings((prev) =>
          prev.map((listing) => {
            const result = findPricingResultForListing(results, listing);
            if (result) {
              return {
                ...listing,
                calculated: computeFullPricingBreakdown(
                  listing.tax_percent,
                  listing.extra_fee_percent,
                  listing.fixed_expenses,
                  result
                ),
              };
            }
            return listing;
          })
        );
      } catch {
        // ignore
      }
    },
    []
  );

  // Auto-calculate when listings are loaded (only once per load)
  const lastCalculatedKey = useRef<string>("");
  const listingsRef = useRef<ListingWithPricing[]>([]);
  
  // Keep ref updated
  useEffect(() => {
    listingsRef.current = listings;
  }, [listings]);
  
  useEffect(() => {
    if (!loading && listings.length > 0 && !calculating) {
      const key = `${page}-${search}-${statusFilter}-${linkFilter}-${skuFilter}`;
      if (lastCalculatedKey.current !== key) {
        const hasUncalculated = listings.some((l) => !l.calculated && l.listing_type_id);
        if (hasUncalculated) {
          lastCalculatedKey.current = key;
          setCalculating(true);
          // Use a copy of listings to avoid stale closure
          const itemsToCalc = [...listings];
          doCalculate(itemsToCalc, isMercadoLider).finally(() => setCalculating(false));
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, listings.length, calculating, page, search, statusFilter, linkFilter, skuFilter]);

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
        }));

      if (itemsToCalculate.length === 0) {
        setCalculating(false);
        return;
      }

      try {
        const { results } = await fetchPricingCalculateBatches(itemsToCalculate, isMercadoLider);

        setListings((prev) =>
          prev.map((listing) => {
            const result = findPricingResultForListing(results, listing);
            if (result) {
              return {
                ...listing,
                calculated: computeFullPricingBreakdown(
                  listing.tax_percent,
                  listing.extra_fee_percent,
                  listing.fixed_expenses,
                  result
                ),
              };
            }
            return listing;
          })
        );
      } catch {
        // ignore
      } finally {
        setCalculating(false);
      }
    },
    [isMercadoLider]
  );

  const handleCalculateAll = useCallback(() => {
    calculatePrices(listings);
  }, [calculatePrices, listings]);

  const persistPlannedPrices = useCallback(
    async (
      items: Array<{ item_id: string; variation_id: number | null; sku?: string; planned_price: number }>,
      opts?: { quietSuccess?: boolean }
    ): Promise<{ ok: boolean; saved: number; error?: string }> => {
      const toSave = items.filter((x) => Number.isFinite(x.planned_price) && x.planned_price >= 0);
      if (toSave.length === 0) return { ok: true, saved: 0 };

      if (!opts?.quietSuccess) setSaveMessage(null);

      try {
        const res = await fetch("/api/pricing/planned-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: toSave.map((l) => ({
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
          return { ok: false, saved: 0, error: err };
        }
        const saved = (data as { saved?: number }).saved ?? toSave.length;
        const savedKeys = new Set(toSave.map((l) => `${l.item_id}:${l.variation_id ?? "n"}`));
        setListings((prev) =>
          prev.map((item) => {
            const key = `${item.item_id}:${item.variation_id ?? "n"}`;
            return savedKeys.has(key) ? { ...item, dirty: false } : item;
          })
        );
        if (!opts?.quietSuccess) {
          setSaveMessage({ type: "ok", text: `${saved} preço(s) salvos (MLB + SKU).` });
          setTimeout(() => setSaveMessage(null), 4000);
        }
        return { ok: true, saved };
      } catch {
        setSaveMessage({ type: "error", text: "Erro ao salvar preços" });
        return { ok: false, saved: 0, error: "Erro ao salvar preços" };
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
      setListings((prev) =>
        prev.map((item) =>
          item.id === listing.id && item.variation_id === listing.variation_id
            ? { ...item, new_price: committedPrice, dirty: true }
            : item
        )
      );
      await handleCalculateSingle({ ...listing, new_price: committedPrice }, { price: committedPrice });
      await persistPlannedPrices(
        [
          {
            item_id: listing.item_id,
            variation_id: listing.variation_id,
            sku: listing.sku ?? undefined,
            planned_price: committedPrice,
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
        const solved = await solvePriceForTargetNetMarginPercent(
          listing,
          targetPct,
          isMercadoLider
        );
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
        const finalCalc =
          (await fetchCalculatedPricingAtPrice(listing, p, isMercadoLider)) ??
          solved.calculated;

        setListings((prev) =>
          prev.map((item) =>
            item.id === listing.id && item.variation_id === listing.variation_id
              ? {
                  ...item,
                  new_price: p,
                  dirty: true,
                  calculated: finalCalc,
                  calculating: false,
                }
              : item
          )
        );
        await persistPlannedPrices(
          [
            {
              item_id: listing.item_id,
              variation_id: listing.variation_id,
              sku: listing.sku ?? undefined,
              planned_price: p,
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
    [isMercadoLider, persistPlannedPrices]
  );

  /** Ajusta a promoção para o mínimo aceito na promoção ML (desconto de 5%). Arredonda para baixo para nunca ultrapassar 95%. */
  const handleApplyMinDiscount = useCallback(
    async (listing: ListingWithPricing) => {
      const newPrice = Math.floor(listing.current_price * 0.95 * 100) / 100;
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
          setSaveMessage({
            type: "ok",
            text: "Promoção ajustada ao mínimo de 5% (promo ML) e salva automaticamente.",
          });
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

    bulkDiscountBusyRef.current = true;
    setListings((prev) =>
      prev.map((item) => {
        const key = listingSelectionKey(item);
        if (!keySet.has(key)) return item;
        const np = priceByKey.get(key)!;
        return { ...item, new_price: np, dirty: true, calculated: undefined };
      })
    );

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
      }));

      const { results, errors } = await fetchPricingCalculateBatches(itemsToCalculate, isMercadoLider);

      setListings((prev) =>
        prev.map((listing) => {
          if (!keySet.has(listingSelectionKey(listing))) return listing;
          const result = findPricingResultForListing(results, listing);
          if (result) {
            return {
              ...listing,
              calculated: computeFullPricingBreakdown(
                listing.tax_percent,
                listing.extra_fee_percent,
                listing.fixed_expenses,
                result
              ),
            };
          }
          return listing;
        })
      );

      const toPersist = eligible.map((l) => ({
        item_id: l.item_id,
        variation_id: l.variation_id,
        sku: l.sku ?? undefined,
        planned_price: priceByKey.get(listingSelectionKey(l))!,
      }));
      const pres = await persistPlannedPrices(toPersist, { quietSuccess: true });

      const skippedNoType = selected.length - eligible.length;
      const errCount = errors.length;
      let msg = `Promoção ajustada para desconto de ${targetDiscountPct}% em ${eligible.length} anúncio(s).`;
      if (skippedNoType > 0) msg += ` ${skippedNoType} ignorado(s) (sem dados para cálculo).`;
      if (errCount > 0) msg += ` Falha no cálculo em ${errCount} linha(s); ajuste manual ou use Calcular Todos.`;
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
      setCalculating(false);
    }
  }, [bulkDiscountPercentInput, listings, selectedIds, isMercadoLider, persistPlannedPrices]);

  const handleBulkDiscountConfirm = useCallback(async () => {
    const ok = await handleBulkApplyDiscountPercent();
    if (ok) {
      setBulkDiscountModalOpen(false);
    }
  }, [handleBulkApplyDiscountPercent]);

  /** Promoção = preço do anúncio no ML (coluna Preço), com recálculo em lote. */
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

    bulkRestoreOriginalBusyRef.current = true;
    setListings((prev) =>
      prev.map((item) => {
        const key = listingSelectionKey(item);
        if (!keySet.has(key)) return item;
        const np = priceByKey.get(key)!;
        return { ...item, new_price: np, dirty: true, calculated: undefined };
      })
    );

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
      }));

      const { results, errors } = await fetchPricingCalculateBatches(itemsToCalculate, isMercadoLider);

      setListings((prev) =>
        prev.map((listing) => {
          if (!keySet.has(listingSelectionKey(listing))) return listing;
          const result = findPricingResultForListing(results, listing);
          if (result) {
            return {
              ...listing,
              calculated: computeFullPricingBreakdown(
                listing.tax_percent,
                listing.extra_fee_percent,
                listing.fixed_expenses,
                result
              ),
            };
          }
          return listing;
        })
      );

      const toPersistRestore = eligible.map((l) => ({
        item_id: l.item_id,
        variation_id: l.variation_id,
        sku: l.sku ?? undefined,
        planned_price: priceByKey.get(listingSelectionKey(l))!,
      }));
      const presRestore = await persistPlannedPrices(toPersistRestore, { quietSuccess: true });

      const skippedNoType = selected.length - eligible.length;
      const errCount = errors.length;
      let msg = `Promoção restaurada para o preço do ML em ${eligible.length} anúncio(s).`;
      if (skippedNoType > 0) msg += ` ${skippedNoType} ignorado(s) (sem preço ou dados para cálculo).`;
      if (errCount > 0) msg += ` Falha no cálculo em ${errCount} linha(s); use Calcular Todos se precisar.`;
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
    try {
      const updates = new Map<string, { price: number; calculated: CalculatedPricing }>();
      let fail = 0;
      for (const l of eligible) {
        const key = listingSelectionKey(l);
        try {
          const solved = await solvePriceForTargetNetMarginPercent(l, targetPct, isMercadoLider);
          if (!solved) {
            fail++;
            continue;
          }
          const p = Math.round(solved.price * 100) / 100;
          const finalCalc =
            (await fetchCalculatedPricingAtPrice(l, p, isMercadoLider)) ?? solved.calculated;
          updates.set(key, { price: p, calculated: finalCalc });
        } catch {
          fail++;
        }
      }

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
              calculating: false,
            };
          }
          return { ...item, calculating: false };
        })
      );

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
      const presMargin = await persistPlannedPrices(toPersistMargin, { quietSuccess: true });

      const skippedNoData = selected.length - eligible.length;
      const ok = updates.size;
      const pctLabel = targetPct.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
      let msg = `Margem líquida alvo ${pctLabel}% aplicada em ${ok} anúncio(s).`;
      if (fail > 0) msg += ` ${fail} sem solução ou com erro.`;
      if (skippedNoData > 0) {
        msg += ` ${skippedNoData} ignorado(s) (sem custo ou tipo de anúncio).`;
      }
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

  const handleSearchSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
    setFiltersModalOpen(false);
  }, [searchInput]);

  const appliedPrecosFilterLabels = useMemo(() => {
    const labels: string[] = [];
    const q = search.trim();
    if (q) labels.push(`Busca: ${q}`);
    const sku = skuFilter.trim();
    if (sku) labels.push(`SKU: ${sku}`);
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
    if (onlyWithSales30d) labels.push("Só com vendas (30d)");
    if (semPromocao) labels.push("Sem promoção");
    if (foraDescontoMin5Ml) labels.push("Desconto < 5% (promo ML)");
    if (semPromoMlAtiva) labels.push("Sem Promo ML ativa");
    if (profitFilter === "high") labels.push("Lucro: > 20%");
    if (profitFilter === "medium") labels.push("Lucro: 10–20%");
    if (profitFilter === "low") labels.push("Lucro: 0–10%");
    if (profitFilter === "negative") labels.push("Lucro: prejuízo");
    if (sortBy === "orders_desc") labels.push("Ordenação: vendas ↓");
    if (sortBy === "orders_asc") labels.push("Ordenação: vendas ↑");
    return labels;
  }, [
    search,
    skuFilter,
    statusFilter,
    linkFilter,
    onlyWithSales30d,
    semPromocao,
    foraDescontoMin5Ml,
    semPromoMlAtiva,
    profitFilter,
    sortBy,
  ]);

  const clearPrecosFilters = useCallback(() => {
    setSearch("");
    setSearchInput("");
    setSkuFilter("");
    setStatusFilter("active");
    setLinkFilter("all");
    setOnlyWithSales30d(false);
    setSemPromocao(false);
    setForaDescontoMin5Ml(false);
    setSemPromoMlAtiva(false);
    setProfitFilter("");
    setSortBy("");
    setPage(1);
    setFiltersModalOpen(false);
  }, []);

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

  useEffect(() => {
    if (!lastUpdatedInfoOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = lastUpdatedInfoRef.current;
      if (el && !el.contains(e.target as Node)) setLastUpdatedInfoOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [lastUpdatedInfoOpen]);

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

  const hasLinkedItems = useMemo(
    () => listings.some((l) => l.product_id),
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

  const filteredListings = useMemo(() => {
    let base = listings;

    if (profitFilter) {
      base = base.filter((listing) => {
        const pct = getProfitPercent(listing);
        if (pct == null) return false;
        switch (profitFilter) {
          case "high":
            return pct > 20;
          case "medium":
            return pct > 10 && pct <= 20;
          case "low":
            return pct > 0 && pct <= 10;
          case "negative":
            return pct <= 0;
          default:
            return true;
        }
      });
    }

    const skuTerm = skuFilter.trim().toLowerCase();
    if (skuTerm) {
      base = base.filter((listing) => (listing.sku ?? "").toLowerCase().includes(skuTerm));
    }

    if (onlyWithSales30d) {
      base = base.filter((listing) => (ordersData[listing.item_id] ?? 0) > 0);
    }

    if (semPromocao) {
      base = base.filter((listing) => {
        const promo = Number(listing.new_price);
        const price = Number(listing.current_price);
        if (!Number.isFinite(promo) || !Number.isFinite(price)) return false;
        return Math.round(promo * 100) === Math.round(price * 100);
      });
    }

    if (foraDescontoMin5Ml) {
      base = base.filter(
        (listing) =>
          listing.current_price > 0 &&
          listing.new_price > 0 &&
          !meetsMlMinCampaignDiscount(listing)
      );
    }

    if (semPromoMlAtiva) {
      base = base.filter((listing) => splitMlActivePromotionsCell(listing.ml_active_promotions).length === 0);
    }

    return base;
  }, [
    listings,
    profitFilter,
    skuFilter,
    getProfitPercent,
    onlyWithSales30d,
    ordersData,
    semPromocao,
    foraDescontoMin5Ml,
    semPromoMlAtiva,
  ]);

  /** Com filtros que dependem do cliente (lucro ou vendas 30d), paginação no cliente; senão usa total do servidor */
  const totalPages = clientSideFiltering
    ? Math.max(1, Math.ceil(filteredListings.length / pageSize))
    : Math.ceil(total / pageSize);

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

  /** Com filtros no cliente (lucro, vendas 30d, sem promoção, fora do mínimo 5% ML), mostra só a fatia da página atual; senão mostra todos da página */
  const sortedListings = useMemo(() => {
    if (!clientSideFiltering) return filteredListings;
    const start = (page - 1) * pageSize;
    return filteredListings.slice(start, start + pageSize);
  }, [filteredListings, clientSideFiltering, page, pageSize]);

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

  const handleToggleSelectOne = useCallback((selectionKey: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(selectionKey)) {
        next.delete(selectionKey);
      } else {
        next.add(selectionKey);
      }
      return next;
    });
  }, []);

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
  }, [campaignName, selectedIds, listings]);

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

  if (loading && listings.length === 0) {
    return (
      <div className="adminty-precos-page space-y-5">
        <div className="overflow-hidden rounded border border-slate-200/90 bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <p className="text-sm text-slate-500 dark:text-slate-400">Carregando…</p>
        </div>
      </div>
    );
  }

  function renderPricingHeaderMenu(colIndex: number, opts?: { sortable?: boolean }) {
    if (headerMenuColumn !== colIndex) return null;
    return (
      <div className="btn-dropdown-menu left-1 top-full z-50 mt-1 w-52 font-normal normal-case tracking-normal shadow-xl">
        {opts?.sortable && (
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
        <button
          type="button"
          onClick={() => toggleStickyColumn(colIndex)}
          className={`btn-dropdown-item ${opts?.sortable ? "border-t border-slate-100 dark:border-slate-600" : ""}`}
        >
          {stickyColumns.has(colIndex) ? "Descongelar coluna" : "Congelar coluna"}
        </button>
      </div>
    );
  }

  function renderPricingColumnHeader(
    colIndex: number,
    label: ReactNode,
    options?: { align?: "left" | "right"; sortable?: boolean; title?: string; thExtraClass?: string }
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
        {renderPricingHeaderMenu(colIndex, { sortable: options?.sortable })}
      </th>
    );
  }

  const refRefreshing =
    !!refJobId && (refJob?.status === "queued" || refJob?.status === "running");

  return (
    <div className="adminty-precos-page space-y-5">
      <div className="overflow-hidden rounded border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <SmartLoaderOverlay
        open={cacheRefreshing || calculating || refRefreshing}
        messages={
          refRefreshing
            ? [
                "Atualizando referências de preço…",
                "Consultando sugestões no Mercado Livre…",
                "Gravando referências para a tabela…",
              ]
            : undefined
        }
        phase={
          cacheRefreshing ? "refresh-cache" : calculating ? "calculate" : "default"
        }
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
                Use os anúncios selecionados nesta página. O preço de cada item virá da &quot;Promoção&quot; salva (planned_price).
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

      {bulkDiscountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !bulkDiscountBusyRef.current && setBulkDiscountModalOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-lg bg-card p-6 shadow-xl dark:border dark:border-slate-600">
            <h2 className="mb-2 text-lg font-semibold">Desconto em massa (selecionados)</h2>
            <p className="mb-4 text-xs text-fg-muted">
              Defina o desconto de promoção para os itens selecionados. Mínimo {ML_MIN_CAMPAIGN_DISCOUNT_PERCENT}% (regra ML) e máximo {ML_MAX_CAMPAIGN_DISCOUNT_PERCENT}% para modalidades configuráveis pelo seller (LIGHTNING, DOD, SELLER_CAMPAIGN, DEAL e PRICE_DISCOUNT).
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
              Aplica a mesma margem líquida desejada (valor a receber − custo, sobre o preço de promoção) em todos os anúncios marcados que tenham custo e tipo de listagem. Pode levar um tempo — há vários cálculos por item.
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

        <div className="border-b border-slate-200 bg-white px-3 pt-3">
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
            <button
              type="button"
              disabled
              className="cursor-not-allowed border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-slate-400"
              title="Em breve"
            >
              Histórico
            </button>
          </div>
        </div>

        {precosTab === "como-funciona" && (
          <div className="max-h-[min(70vh,720px)] overflow-y-auto border-b border-slate-100 bg-white px-4 py-4 dark:bg-slate-900/20">
            <PrecosHelpContent />
          </div>
        )}

        {precosTab === "calculadora" && (
        <div>
        <div className="border-b border-slate-100 px-3 py-3">
          <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 shadow-sm">
            <input
              type="checkbox"
              checked={isMercadoLider}
              onChange={(e) => setIsMercadoLider(e.target.checked)}
              className="h-3 w-3 rounded border-slate-300 text-primary focus:ring-primary"
              disabled={reputationLoading}
            />
            <span>Mercado Líder (calcular frete)</span>
          </label>
          <div className="btn-dropdown relative" ref={globalActionsRef}>
            <button
              type="button"
              onClick={() => setGlobalActionsOpen((o) => !o)}
              className="btn btn-secondary btn-sm"
              title="Atualizar cache, referências de preço ou recalcular taxas"
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
                className="btn-dropdown-menu right-0 min-w-[260px]"
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
                  title="Atualiza só as referências de preço / competitividade no Mercado Livre, sem refazer o cache inteiro de anúncios"
                >
                  {refRefreshing ? "Atualizando referência…" : "Atualizar referência"}
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
                  title="Recalcula taxas e valores líquidos para todas as linhas (promoção atual)"
                >
                  {calculating ? "Calculando…" : "Calcular Todos"}
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
              <div className="btn-dropdown-menu right-0 min-w-[280px]" role="menu">
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
                  title="Define a promoção igual ao preço do Mercado Livre (última sync) em cada selecionado"
                >
                  Voltar promoção ao preço (ML)
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
                  title="Informe a margem líquida desejada (%); a promoção de cada selecionado será recalculada"
                >
                  Definir margem líquida (%)…
                </button>
              </div>
            )}
          </div>
        </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[12px] text-slate-600">
            <span className="font-semibold text-slate-700">Filtros:</span>
            {appliedPrecosFilterLabels.length > 0 ? (
              appliedPrecosFilterLabels.map((label, idx) => (
                <span
                  key={`${idx}-${label}`}
                  className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="text-slate-500">Nenhum filtro aplicado</span>
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
          <div className="btn-dropdown relative flex items-center gap-1" ref={optionsMenuRef}>
            <div className="relative" ref={lastUpdatedInfoRef}>
              <button
                type="button"
                onClick={() => {
                  setOptionsMenuOpen(false);
                  setLastUpdatedInfoOpen((o) => !o);
                }}
                title={
                  lastUpdatedAt
                    ? `Última atualização: ${lastUpdatedFormatted} (horário de São Paulo).`
                    : "Ainda não há registro da última atualização do cache nesta conta."
                }
                aria-label="Última atualização do cache"
                aria-expanded={lastUpdatedInfoOpen}
                className="btn btn-icon btn-sm btn-outline-secondary"
              >
                <ClockIcon />
              </button>
              {lastUpdatedInfoOpen && (
                <div className="absolute right-0 top-9 z-30 w-72 rounded border border-slate-200 bg-white px-3 py-2 text-left text-[11px] leading-snug text-slate-700 shadow-lg dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                  {lastUpdatedAt ? (
                    <>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">Última atualização</span>
                      {": "}
                      {lastUpdatedFormatted}
                      <span className="text-slate-500"> (horário de São Paulo).</span>
                    </>
                  ) : (
                    <>Ainda não há registro da última atualização do cache nesta conta.</>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setLastUpdatedInfoOpen(false);
                setSearchInput(search);
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
              onClick={() => {
                setLastUpdatedInfoOpen(false);
                setOptionsMenuOpen((o) => !o);
              }}
              className="btn btn-icon btn-sm btn-outline-secondary"
              title="Opções"
              aria-label="Opções"
              aria-expanded={optionsMenuOpen}
            >
              <KebabMenuIcon />
            </button>
            {optionsMenuOpen && (
              <div className="btn-dropdown-menu right-0 top-9 z-20 w-52">
                <button
                  type="button"
                  onClick={() => {
                    void loadListings();
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

      {dirtyCount > 0 && (
        <div className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-700">
          {dirtyCount} item(s) com alteração ainda não confirmada no campo (saia do campo com Tab ou clique fora para
          recalcular e gravar automaticamente).
        </div>
      )}

      {!hasLinkedItems && listings.length > 0 && (
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
            className="mt-3 rounded-full border border-amber-300 bg-white px-4 py-2 text-xs font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="mb-1 flex min-h-8 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              <span className="font-medium text-slate-800 dark:text-slate-100">{sortedListings.length}</span>
              {" anúncio(s) na página"}
              {clientSideFiltering ? (
                <>
                  {" · "}
                  <span className="font-medium text-slate-800 dark:text-slate-100">{filteredListings.length}</span>
                  {" filtrados"}
                </>
              ) : null}
              {" · total "}
              <span className="font-medium text-slate-800 dark:text-slate-100">{total}</span>
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {clientSideFiltering && total > listings.length && listings.length < MAX_CLIENT_SIDE_LOAD && (
                <button
                  type="button"
                  onClick={() => setLoadAllResults(true)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/50"
                  title="Carregar até 10.000 itens para aplicar os filtros em todo o resultado"
                >
                  Carregar todos (até 10.000)
                </button>
              )}
              <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                Linhas
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setPageSize(value);
                    setPage(1);
                  }}
                  className="h-6 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-700 shadow-sm focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                  aria-label="Linhas por página"
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
                    sortable: true,
                    title: "Pedidos pagos nos últimos 30 dias. Ordene pelo menu ▾.",
                  }
                )}
                {renderPricingColumnHeader(6, "Custo", { align: "right" })}
                {renderPricingColumnHeader(7, "Promo ML", {
                  align: "right",
                  title:
                    "Quantidade de campanhas/promoções ativas no ML. Detalhes no tooltip ao passar o mouse sobre o badge. Atualizado com o cache.",
                })}
                {renderPricingColumnHeader(8, "Preço", { align: "right" })}
                {renderPricingColumnHeader(9, "Competitividade", {
                  align: "right",
                  title: "Referência de preço do Mercado Livre (sugestão / faixa competitiva)",
                })}
                {renderPricingColumnHeader(10, "Margem", {
                  align: "right",
                  title:
                    "(Lucro) ÷ preço Promoção, com Lucro = Vai receber − custo − imposto − taxa extra − desp. fixas",
                })}
                {renderPricingColumnHeader(11, "Promoção", { align: "right", title: "Promoção ML exige desconto ≥ 5%" })}
                {renderPricingColumnHeader(12, "Vai Receber", {
                  align: "right",
                  title: "Valor bruto (Promoção) − taxa ML − frete",
                })}
                {renderPricingColumnHeader(13, "Lucro", { align: "right" })}
                {renderPricingColumnHeader(14, "Taxa ML", { align: "right" })}
                {renderPricingColumnHeader(15, "Frete", { align: "right" })}
                {renderPricingColumnHeader(16, "Imposto", { align: "right", title: "Imposto sobre o preço" })}
                {renderPricingColumnHeader(17, "Taxa Extra", { align: "right", title: "Taxa extra sobre o preço" })}
                {renderPricingColumnHeader(18, "Desp. Fixas", {
                  align: "right",
                  title: "Despesas fixas em R$ (cadastrado no produto)",
                })}
                {renderPricingColumnHeader(19, "Link")}
              </tr>
            </thead>
            <tbody>
              {sortedListings.map((listing) => {
                const profit =
                  listing.calculated && listing.cost_price != null
                    ? listing.calculated.net_amount - listing.cost_price
                    : null;
                const profitPercent =
                  profit != null && listing.new_price > 0
                    ? (profit / listing.new_price) * 100
                    : null;

                const isSelected = selectedIds.has(listingSelectionKey(listing));

                return (
                  <tr
                    key={`${listing.id}-${listing.variation_id ?? "item"}`}
                    className="border-b border-slate-100 bg-white/50 hover:bg-primary/5 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:bg-primary/10"
                  >
                    <td
                      className={`p-2 text-center ${stickyColumns.has(0) ? "sticky-col" : ""}`}
                      style={stickyBodyStyles[0]}
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={isSelected}
                        onChange={() => handleToggleSelectOne(listingSelectionKey(listing))}
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
                          className="cursor-pointer select-none rounded-md bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100"
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
                          return (
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => handleCopyToClipboard(primary, `sku-${listing.id}-${listing.variation_id ?? "n"}`)}
                          onKeyDown={(e) => e.key === "Enter" && handleCopyToClipboard(primary, `sku-${listing.id}-${listing.variation_id ?? "n"}`)}
                          title={listing.sku}
                          className="cursor-pointer select-none inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-left hover:bg-slate-100"
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
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(6) ? "sticky-col" : ""}`} style={stickyBodyStyles[6]}>
                      {listing.cost_price != null ? (
                        <span className="text-fg">
                          R$ {formatBRL(listing.cost_price)}
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </td>
                    <td className={`p-2 text-right ${stickyColumns.has(7) ? "sticky-col" : ""}`} style={stickyBodyStyles[7]}>
                      <MlActivePromotionsCell text={listing.ml_active_promotions} />
                    </td>
                    <td className={`p-2 text-right text-sm font-medium ${stickyColumns.has(8) ? "sticky-col" : ""}`} style={stickyBodyStyles[8]}>
                      R$ {formatBRL(listing.current_price)}
                    </td>
                    <td className={`p-2 text-right ${stickyColumns.has(9) ? "sticky-col" : ""}`} style={stickyBodyStyles[9]}>
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
                    <td className={`p-2 text-right ${stickyColumns.has(10) ? "sticky-col" : ""}`} style={stickyBodyStyles[10]}>
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
                    <td className={`p-2 ${stickyColumns.has(11) ? "sticky-col" : ""}`} style={stickyBodyStyles[11]}>
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
                            title="Clique para ajustar ao desconto mínimo de 5% (promoção = 95% do preço)"
                          >
                            Ajustar para 5%
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={`p-2 text-right text-sm font-semibold ${stickyColumns.has(12) ? "sticky-col" : ""}`} style={stickyBodyStyles[12]}>
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
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(13) ? "sticky-col" : ""}`} style={stickyBodyStyles[13]}>
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
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(14) ? "sticky-col" : ""}`} style={stickyBodyStyles[14]}>
                      {listing.calculating ? (
                        <span className="text-fg-muted">…</span>
                      ) : listing.calculated ? (
                        <span className="text-amber-700">
                          R$ {formatBRL(listing.calculated.fee)}
                        </span>
                      ) : !listing.listing_type_id ? (
                        <span className="text-red-400" title="Tipo de anúncio não disponível">
                          N/D
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
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(16) ? "sticky-col" : ""}`} style={stickyBodyStyles[16]}>
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
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(17) ? "sticky-col" : ""}`} style={stickyBodyStyles[17]}>
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
                    <td className={`p-2 text-right text-sm ${stickyColumns.has(18) ? "sticky-col" : ""}`} style={stickyBodyStyles[18]}>
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
                    <td className={`p-2 ${stickyColumns.has(19) ? "sticky-col" : ""}`} style={stickyBodyStyles[19]}>
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

      {filtersModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setFiltersModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Filtros"
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-800">Filtros</h2>
                <p className="text-xs text-slate-500">Refine busca, status, vínculo e lucratividade.</p>
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
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Buscar</label>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Título ou MLB…"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">SKU</label>
                <input
                  type="text"
                  value={skuFilter}
                  onChange={(e) => setSkuFilter(e.target.value)}
                  placeholder="Filtrar por SKU…"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd]"
                >
                  <option value="">Todos os status</option>
                  <option value="active">Ativo</option>
                  <option value="paused">Pausado</option>
                  <option value="closed">Fechado</option>
                  <option value="under_review">Em revisão</option>
                  <option value="inactive">Inativo</option>
                  <option value="deleted">Removido</option>
                  <option value="not_yet_active">Aguardando ativação</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Vínculo MLB → produto</label>
                <select
                  value={linkFilter}
                  onChange={(e) => {
                    setLinkFilter(e.target.value as "all" | "linked" | "unlinked");
                    setPage(1);
                  }}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-[#0d6efd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd]"
                >
                  <option value="all">Todos</option>
                  <option value="linked">Só vinculados</option>
                  <option value="unlinked">Só não vinculados</option>
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2" title="Exibe apenas anúncios com pelo menos 1 venda nos últimos 30 dias">
                <input
                  type="checkbox"
                  checked={onlyWithSales30d}
                  onChange={(e) => {
                    setOnlyWithSales30d(e.target.checked);
                    setPage(1);
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-primary"
                />
                <span className="text-xs text-slate-700">Só com vendas (30d)</span>
              </label>
              <label
                className="flex cursor-pointer items-center gap-2"
                title="Promoção planejada igual ao preço atual no Mercado Livre (sem desconto em relação ao anúncio)"
              >
                <input
                  type="checkbox"
                  checked={semPromocao}
                  onChange={(e) => {
                    setSemPromocao(e.target.checked);
                    setPage(1);
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-primary"
                />
                <span className="text-xs text-slate-700">Sem promoção</span>
              </label>
              <label
                className="flex cursor-pointer items-center gap-2"
                title="Promoção acima de 95% do preço do anúncio (desconto menor que 5%) — não serve para campanha de promoção do ML até ajustar"
              >
                <input
                  type="checkbox"
                  checked={foraDescontoMin5Ml}
                  onChange={(e) => {
                    setForaDescontoMin5Ml(e.target.checked);
                    setPage(1);
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-primary"
                />
                <span className="text-xs text-slate-700">Desconto &lt; 5% (promo ML)</span>
              </label>
              <label
                className="flex cursor-pointer items-center gap-2"
                title="Exibe apenas anúncios sem campanhas/promoções ativas no Mercado Livre (coluna Promo ML = 0) no último refresh do cache"
              >
                <input
                  type="checkbox"
                  checked={semPromoMlAtiva}
                  onChange={(e) => {
                    setSemPromoMlAtiva(e.target.checked);
                    setPage(1);
                  }}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-primary focus:ring-primary"
                />
                <span className="text-xs text-slate-700">Sem Promo ML ativa</span>
              </label>
              <div>
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Lucratividade</span>
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      { value: "", label: "Todos" },
                      { value: "high", label: "> 20%" },
                      { value: "medium", label: "10–20%" },
                      { value: "low", label: "0–10%" },
                      { value: "negative", label: "Prejuízo" },
                    ]
                  ).map(({ value, label }) => (
                    <button
                      key={value || "all"}
                      type="button"
                      onClick={() => setProfitFilter(value as "" | "high" | "medium" | "low" | "negative")}
                      className={`btn btn-mini ${profitFilter === value ? "btn-primary" : "btn-outline-secondary"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => clearPrecosFilters()} className="btn btn-secondary btn-sm">
                  Limpar filtros
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Aplicar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
