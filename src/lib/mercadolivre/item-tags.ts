/** Lista fixa para SQL / filtros em array (tags_text). */
export const CRITICAL_ML_ITEM_TAGS_LIST = [
  "incomplete_technical_specs",
  "catalog_listing_eligible",
  "catalog_boost",
  "catalog_forewarning",
  "catalog_only_restricted",
  "catalog_listing_required",
  "catalog_required",
  "opt_obey",
  "user_product_listing",
  "variations_migration_pending",
  "variations_migration_uptin",
  "variations_migration_source",
  "poor_quality_thumbnail",
  "moderation_penalty",
] as const;

export const CRITICAL_ML_ITEM_TAGS = new Set<string>(CRITICAL_ML_ITEM_TAGS_LIST);

const ML_ITEM_TAG_LABELS: Record<string, string> = {
  incomplete_technical_specs: "Ficha incompleta",
  catalog_listing_eligible: "Elegível catálogo",
  catalog_boost: "Catálogo otimizado",
  catalog_forewarning: "Aviso catálogo",
  catalog_only_restricted: "Só catálogo",
  catalog_listing_required: "Catálogo obrigatório",
  catalog_required: "Requer catálogo",
  opt_obey: "Domínio obrigatório",
  user_product_listing: "User Product",
  variations_migration_pending: "Migração UP pendente",
  variations_migration_uptin: "Migração UP",
  variations_migration_source: "Migração UP origem",
  poor_quality_thumbnail: "Foto fraca",
  moderation_penalty: "Penalidade moderação",
};

export function parseMlItemTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const s = String(t).trim().toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function filterCriticalMlItemTags(tags: string[]): string[] {
  return tags.filter((t) => CRITICAL_ML_ITEM_TAGS.has(t.trim().toLowerCase()));
}

export function formatMlItemTagLabel(tag: string): string {
  const key = tag.trim().toLowerCase();
  if (ML_ITEM_TAG_LABELS[key]) return ML_ITEM_TAG_LABELS[key];
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Opções do filtro Alertas ML na tela Anúncios. */
export const ML_ALERT_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "any", label: "Com qualquer alerta ML" },
  { value: "none", label: "Sem alertas ML" },
  ...Array.from(CRITICAL_ML_ITEM_TAGS)
    .map((id) => ({ value: id, label: formatMlItemTagLabel(id) }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
];

export type StockCompareOp = "gt" | "gte" | "lt" | "lte" | "eq";

export const STOCK_COMPARE_OPS: StockCompareOp[] = ["gt", "gte", "lt", "lte", "eq"];

export const STOCK_COMPARE_LABELS: Record<StockCompareOp, string> = {
  gt: "maior que (>)",
  gte: "maior ou igual (≥)",
  lt: "menor que (<)",
  lte: "menor ou igual (≤)",
  eq: "igual a (=)",
};

export function stockCompareLabel(op: StockCompareOp): string {
  return STOCK_COMPARE_LABELS[op];
}

/** Chips de alerta ML — fundos sólidos no escuro (evita bg-*-100 “branco” com texto claro). */
export function mlItemTagBadgeClass(tag: string): string {
  const base =
    "ml-item-tag inline-flex shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight ring-1 ring-inset";
  const t = tag.toLowerCase();
  if (
    t === "incomplete_technical_specs" ||
    t === "moderation_penalty" ||
    t === "poor_quality_thumbnail" ||
    t === "catalog_forewarning" ||
    t === "catalog_listing_required" ||
    t === "catalog_required"
  ) {
    return `${base} bg-red-100 text-red-900 ring-red-300/90 dark:bg-red-950 dark:text-red-100 dark:ring-red-700/90`;
  }
  if (t === "variations_migration_pending" || t === "catalog_only_restricted" || t === "opt_obey") {
    return `${base} bg-amber-100 text-amber-950 ring-amber-300/90 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-700/90`;
  }
  return `${base} bg-sky-100 text-sky-900 ring-sky-300/90 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-700/90`;
}

/** Exibe saúde 0–1 do ML como percentual. */
export function formatMlItemHealth(health: number | null | undefined): string {
  if (health == null || Number.isNaN(Number(health))) return "—";
  const n = Number(health);
  if (n > 0 && n <= 1) return `${Math.round(n * 100)}%`;
  if (n > 1 && n <= 100) return `${Math.round(n)}%`;
  return String(n);
}

export function mlItemHealthClass(health: number | null | undefined): string {
  if (health == null || Number.isNaN(Number(health))) {
    return "text-slate-500 dark:text-slate-400";
  }
  const n = Number(health);
  const score = n > 0 && n <= 1 ? n : n / 100;
  if (score >= 0.8) return "font-semibold text-emerald-700 dark:text-emerald-300";
  if (score >= 0.6) return "font-semibold text-amber-700 dark:text-amber-300";
  return "font-semibold text-red-700 dark:text-red-300";
}
