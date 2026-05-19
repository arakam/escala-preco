import type { MlCampaignItemRow, MlSellerCampaignRow } from "@/lib/mercadolivre/fetch-seller-campaigns";
import {
  inferPromotionTypeFromAnyLabelText,
  normalizeMlPromotionTypeCode,
} from "@/lib/mercadolivre/ml-promotion-types";

/**
 * Normaliza resposta de GET /seller-promotions/items/{item_id}?app_version=v2
 * e resume promoções consideradas ativas para exibição na tela de preços.
 */

/** Interpreta `type` como string, número ou objeto (`id`, `name`, `value`, `code`). */
function promotionTypeValueToCode(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    for (const k of ["id", "name", "value", "code"] as const) {
      const v = o[k];
      if (v != null && v !== "") {
        const c = normalizeMlPromotionTypeCode(String(v));
        if (c) return c;
      }
    }
    return null;
  }
  const c = normalizeMlPromotionTypeCode(String(raw));
  return c || null;
}

const TYPE_FIELD_KEYS = [
  "type",
  "promotion_type",
  "promotionType",
  "deal_type",
  "dealType",
  "campaign_type",
  "campaignType",
  "offer_type",
  "offerType",
] as const;

/** Objetos filhos onde o ML costuma repetir metadados da campanha (incl. `type`). */
function sellerPromotionTypeLookupObjects(p: Record<string, unknown>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [p];
  for (const key of [
    "promotion",
    "benefit",
    "benefits",
    "campaign",
    "offer",
    "deal",
    "detail",
    "details",
    "metadata",
  ] as const) {
    const v = p[key];
    if (Array.isArray(v)) {
      for (const x of v) {
        if (isPlainObject(x)) out.push(x);
      }
    } else if (isPlainObject(v)) {
      out.push(v);
    }
  }
  return out;
}

function getSellerPromotionTypeCodeFromFlatObject(o: Record<string, unknown>): string | null {
  for (const key of TYPE_FIELD_KEYS) {
    const raw = o[key];
    if (raw == null || raw === "") continue;
    const c = promotionTypeValueToCode(raw);
    if (c) return c;
  }
  return null;
}

/**
 * Valor do campo `type` em um objeto retornado por GET /seller-promotions/items/... (v2).
 * O ML envia `type` no raiz, dentro de `promotion` / `benefit` / `benefits`, como string ou como
 * objeto `{ id: "LIGHTNING" }` / `{ name: "DEAL" }`, etc.
 */
export function getSellerPromotionTypeCode(p: Record<string, unknown>): string | null {
  for (const obj of sellerPromotionTypeLookupObjects(p)) {
    const c = getSellerPromotionTypeCodeFromFlatObject(obj);
    if (c) return c;
  }
  return null;
}

/** Converte valor de data do ML (ISO ou timestamp) para ISO UTC, ou null. */
function parseSellerPromotionDateIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const s = String(v).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

/** Início da campanha (`start_date`, etc.) conforme seller-promotions. */
export function getSellerPromotionStartIso(p: Record<string, unknown>): string | null {
  for (const key of [
    "start_date",
    "startDate",
    "date_start",
    "begins_at",
    "from_date",
    "start_time",
  ] as const) {
    const iso = parseSellerPromotionDateIso(p[key]);
    if (iso) return iso;
  }
  return null;
}

/** Fim da campanha (`finish_date`, `end_date`, etc.). */
export function getSellerPromotionFinishIso(p: Record<string, unknown>): string | null {
  for (const key of [
    "finish_date",
    "finishDate",
    "end_date",
    "endDate",
    "date_end",
    "deadline",
    "to_date",
    "end_time",
  ] as const) {
    const iso = parseSellerPromotionDateIso(p[key]);
    if (iso) return iso;
  }
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Campanha co-participação PIX (`type` BANK, `payment_method` PIX). */
export function isBankPixCofinancedPromotion(p: Record<string, unknown>): boolean {
  const code = getSellerPromotionTypeCode(p);
  if (code === "BANK" || (code != null && code.startsWith("BANK"))) return true;
  const pm = String(p.payment_method ?? p.paymentMethod ?? "").trim().toUpperCase();
  if (pm === "PIX") return true;
  for (const obj of sellerPromotionTypeLookupObjects(p)) {
    const sub = String(obj.sub_type ?? obj.subType ?? "").trim().toUpperCase();
    if (sub === "COFINANCED" && pm === "PIX") return true;
  }
  return false;
}

/** Lista de objetos promoção a partir do JSON do ML (array, results, objeto único, etc.). */
export function normalizeSellerPromotionsList(raw: unknown): Record<string, unknown>[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter(isPlainObject) as Record<string, unknown>[];
  }
  if (isPlainObject(raw)) {
    if (Array.isArray(raw.results)) return raw.results.filter(isPlainObject) as Record<string, unknown>[];
    if (Array.isArray(raw.promotions)) return raw.promotions.filter(isPlainObject) as Record<string, unknown>[];
    if (Array.isArray(raw.offers)) return raw.offers.filter(isPlainObject) as Record<string, unknown>[];
    if (Array.isArray(raw.benefits)) return raw.benefits.filter(isPlainObject) as Record<string, unknown>[];
    if (Array.isArray(raw.data)) return raw.data.filter(isPlainObject) as Record<string, unknown>[];
    if (raw.type != null || raw.status != null || raw.id != null) {
      return [raw];
    }
    const vals = Object.values(raw);
    if (vals.length > 0 && vals.every((v) => isPlainObject(v))) {
      return vals as Record<string, unknown>[];
    }
  }
  return [];
}

/**
 * Promoção “ativa” para o vendedor: em andamento no ML ou pendente com preço de venda já definido.
 * Ignoramos em geral `candidate` sem preço (ainda não aplicada).
 */
/** Status aninhado `{ id: "candidate" }` ou string. */
export function getSellerPromotionStatusId(p: Record<string, unknown>): string {
  const st = p.status;
  if (st != null && typeof st === "object" && !Array.isArray(st)) {
    const id = (st as Record<string, unknown>).id;
    if (id != null) return String(id).toLowerCase();
  }
  return String(p.status ?? "").toLowerCase();
}

export function isActiveSellerPromotion(p: Record<string, unknown>): boolean {
  const nestedId = getSellerPromotionStatusId(p);
  if (nestedId === "started" || nestedId === "active") return true;
  if (nestedId === "pending") {
    const amt = getSellerPromotionPriceAmount(p);
    return amt != null && amt > 0;
  }
  return false;
}

/** Convite / pendente sem preço de venda — “promoção possível”. */
export function isPossibleSellerPromotion(p: Record<string, unknown>): boolean {
  if (isActiveSellerPromotion(p)) return false;
  const sid = getSellerPromotionStatusId(p);
  if (sid === "candidate") return true;
  if (sid === "pending") {
    if (isBankPixCofinancedPromotion(p)) return true;
    const amt = getSellerPromotionPriceAmount(p);
    return amt == null || amt <= 0;
  }
  return false;
}

/** PIX/BANK e outros status que a lógica genérica descartava. */
export function classifySellerPromotionPartition(
  p: Record<string, unknown>
): "active" | "possible" | null {
  if (isActiveSellerPromotion(p)) return "active";
  if (isPossibleSellerPromotion(p)) return "possible";
  if (!isBankPixCofinancedPromotion(p)) return null;
  const sid = getSellerPromotionStatusId(p);
  if (sid === "finished" || sid === "inactive") return null;
  if (sid === "candidate") return "possible";
  if (sid === "started" || sid === "active" || sid === "pending" || sid === "programmed") {
    return "active";
  }
  return "possible";
}

/** Parte a resposta de GET /seller-promotions/items/{id} para exibição. */
export function partitionSellerPromotionsForDisplay(raw: unknown): {
  active: string[];
  possible: string[];
} {
  const { active, possible } = partitionSellerPromotionsRich(raw);
  return {
    active: active.map((r) => formatDisplayRowAsLine(r)),
    possible: possible.map((r) => formatDisplayRowAsLine(r)),
  };
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatPromotionValuePart(p: Record<string, unknown>): string {
  const effective = getSellerPromotionPriceAmount(p);
  if (effective != null) return brl.format(effective);

  const fp = p.fixed_percentage;
  if (fp != null && Number.isFinite(Number(fp))) return `${fp}% (pct. fixo)`;

  const fa = p.fixed_amount;
  if (fa != null && Number.isFinite(Number(fa))) return `${brl.format(Number(fa))} (valor fixo)`;

  const mp = p.meli_percentage;
  const sp = p.seller_percentage;
  if ((mp != null && Number.isFinite(Number(mp))) || (sp != null && Number.isFinite(Number(sp)))) {
    return `ML ${mp ?? 0}% · vend. ${sp ?? 0}%`;
  }

  const range = getSellerPromotionPriceRangeHint(p);
  if (range) return range;

  return "—";
}

/** ML enviou faixa completa (mín., máx. e sugerido) para definir preço na campanha. */
export function hasSellerPromotionFullDiscountRange(p: Record<string, unknown>): boolean {
  const min = Number(p.min_discounted_price);
  const max = Number(p.max_discounted_price);
  const suggested = Number(p.suggested_discounted_price);
  return (
    Number.isFinite(min) &&
    min > 0 &&
    Number.isFinite(max) &&
    max > 0 &&
    Number.isFinite(suggested) &&
    suggested > 0
  );
}

/**
 * Preço na campanha (BRL) em seller-promotions/items:
 * com faixa min/max/sugerido → `max_discounted_price`;
 * senão `price` quando > 0; senão `suggested_discounted_price`.
 */
export function getSellerPromotionPriceAmount(p: Record<string, unknown>): number | null {
  if (hasSellerPromotionFullDiscountRange(p)) {
    return Number(p.max_discounted_price);
  }
  const price = Number(p.price);
  if (Number.isFinite(price) && price > 0) return price;
  const suggested = Number(p.suggested_discounted_price);
  if (Number.isFinite(suggested) && suggested > 0) return suggested;
  if (isBankPixCofinancedPromotion(p)) {
    const orig = getSellerPromotionOriginalPriceAmount(p);
    const meli = Number(p.meli_percentage);
    const seller = Number(p.seller_percentage);
    if (orig != null && orig > 0 && (Number.isFinite(meli) || Number.isFinite(seller))) {
      const pct = Math.min(100, Math.max(0, (meli > 0 ? meli : 0) + (seller > 0 ? seller : 0)));
      if (pct > 0) return Math.round(orig * (1 - pct / 100) * 100) / 100;
    }
  }
  return null;
}

/** `original_price` — preço do item sem desconto (doc ML). */
export function getSellerPromotionOriginalPriceAmount(p: Record<string, unknown>): number | null {
  const orig = Number(p.original_price);
  if (Number.isFinite(orig) && orig > 0) return orig;
  return null;
}

/** Faixa na coluna Promoção (mín./sug.) quando o máx. já é o Preço promoção. */
export function getSellerPromotionPriceRangeHint(p: Record<string, unknown>): string | null {
  const min = Number(p.min_discounted_price);
  const max = Number(p.max_discounted_price);
  const suggested = Number(p.suggested_discounted_price);
  const parts: string[] = [];
  if (Number.isFinite(min) && min > 0) parts.push(`mín. ${brl.format(min)}`);
  if (hasSellerPromotionFullDiscountRange(p)) {
    if (Number.isFinite(suggested) && suggested > 0) {
      parts.push(`sug. ${brl.format(suggested)}`);
    }
  } else if (Number.isFinite(max) && max > 0) {
    parts.push(`máx. ${brl.format(max)}`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

/**
 * Subsídio do Mercado Livre sobre a taxa de venda (ex. SMART): `meli_percentage` sobre `original_price`, em R$.
 * Abate direto na taxa ML conforme retorno do seller-promotions.
 */
export function getSellerPromotionMeliFeeSubsidyBrl(p: Record<string, unknown>): number | null {
  const orig = Number(p.original_price);
  const meli = Number(p.meli_percentage);
  if (!Number.isFinite(orig) || orig <= 0) return null;
  if (!Number.isFinite(meli) || meli <= 0) return null;
  return Math.round(((orig * meli) / 100) * 100) / 100;
}

export function formatSellerPromotionTitle(p: Record<string, unknown>): string {
  const code = getSellerPromotionTypeCode(p);
  const paymentMethod = String(p.payment_method ?? p.paymentMethod ?? "").trim().toUpperCase();
  const nameRaw = String(p.name ?? "").trim();
  let name = nameRaw;
  if (!name && isBankPixCofinancedPromotion(p)) {
    name = paymentMethod === "PIX" ? "Desconto no PIX" : "Meio de pagamento (BANK)";
  }
  if (!name) name = code ?? "Promoção";
  const typ = code && nameRaw ? ` · ${code}` : code && !nameRaw && code !== name ? ` · ${code}` : "";
  return `${name}${typ}`;
}

/** `id` da promoção na resposta GET seller-promotions/items (ex.: P-MLB…, C-MLB…). */
export function getSellerPromotionApiId(p: Record<string, unknown>): string | null {
  for (const obj of sellerPromotionTypeLookupObjects(p)) {
    const raw = obj.id ?? obj.promotion_id ?? obj.promotionId;
    if (raw == null || raw === "") continue;
    const s = String(raw).trim();
    if (s.length > 0) return s;
  }
  return null;
}

export type SellerPromotionDisplayRow = {
  label: string;
  /** Preço sem desconto (`original_price` na API). */
  original_price: number | null;
  promo_price: number | null;
  /** Texto de benefício (%, co-participação, faixa min/máx, etc.). */
  value_hint: string | null;
  /** Abatimento na taxa ML (R$): original_price × meli_percentage / 100 quando o ML informa subsídio (ex. SMART). */
  meli_fee_subsidy: number | null;
  /** Campo `type` da API (ex.: DEAL, SMART). */
  promotion_type: string | null;
  /** Campo `id` da API (identificador estável da campanha/promoção no ML). */
  ml_promotion_id: string | null;
  /** Início da campanha (ISO UTC) quando o ML informar. */
  campaign_start_at: string | null;
  /** Fim da campanha (ISO UTC) quando o ML informar. */
  campaign_finish_at: string | null;
};

function mergePromotionValueHints(...parts: Array<string | null | undefined>): string | null {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const s = raw?.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length > 0 ? out.join(" · ") : null;
}

function getSellerPromotionValueHint(
  p: Record<string, unknown>,
  promoPrice: number | null
): string | null {
  const part = formatPromotionValuePart(p);
  const range = getSellerPromotionPriceRangeHint(p);
  if (part === "—") return range;
  if (promoPrice != null) {
    const formatted = brl.format(promoPrice);
    if (part === formatted || part.endsWith(formatted) || part.includes(formatted)) {
      return range;
    }
  }
  return mergePromotionValueHints(part, range);
}

function formatDisplayRowAsLine(r: SellerPromotionDisplayRow): string {
  if (r.value_hint) return `${r.label} — ${r.value_hint}`;
  if (r.promo_price != null) return `${r.label} — ${brl.format(r.promo_price)}`;
  return `${r.label} — —`;
}

/** Texto multilinha para `pricing_cache.ml_active_promotions` a partir do cache de promoções. */
export function buildMlActivePromotionsStorageTextFromDisplayRows(
  rows: Pick<SellerPromotionDisplayRow, "label" | "promo_price" | "value_hint">[]
): string {
  if (rows.length === 0) return "";
  return rows
    .map((r) => formatDisplayRowAsLine(r as SellerPromotionDisplayRow))
    .join("\n");
}

/** Uma entrada por promoção, com preço isolado para coluna própria na UI. */
export function partitionSellerPromotionsRich(raw: unknown): {
  active: SellerPromotionDisplayRow[];
  possible: SellerPromotionDisplayRow[];
} {
  const list = normalizeSellerPromotionsList(raw);
  const active: SellerPromotionDisplayRow[] = [];
  const possible: SellerPromotionDisplayRow[] = [];
  for (const p of list) {
    const promoPrice = getSellerPromotionPriceAmount(p);
    const originalPrice = getSellerPromotionOriginalPriceAmount(p);
    const label = formatSellerPromotionTitle(p);
    const value_hint = getSellerPromotionValueHint(p, promoPrice);
    const meli_fee_subsidy = getSellerPromotionMeliFeeSubsidyBrl(p);
    const promotion_type =
      getSellerPromotionTypeCode(p) ?? inferPromotionTypeFromAnyLabelText(label);
    const campaign_start_at = getSellerPromotionStartIso(p);
    const campaign_finish_at = getSellerPromotionFinishIso(p);
    const ml_promotion_id = getSellerPromotionApiId(p);
    const row: SellerPromotionDisplayRow = {
      label,
      original_price: originalPrice,
      promo_price: promoPrice,
      value_hint,
      meli_fee_subsidy,
      promotion_type,
      campaign_start_at,
      campaign_finish_at,
      ml_promotion_id,
    };
    const bucket = classifySellerPromotionPartition(p);
    if (bucket === "active") active.push(row);
    else if (bucket === "possible") possible.push(row);
  }
  return { active, possible };
}

function mergePromotionDisplayRows(
  base: SellerPromotionDisplayRow[],
  extra: SellerPromotionDisplayRow[]
): SellerPromotionDisplayRow[] {
  if (extra.length === 0) return base;
  const seen = new Set(
    base.map((r) => `${r.ml_promotion_id ?? ""}|${r.promotion_type ?? ""}|${r.label}`)
  );
  const out = [...base];
  for (const r of extra) {
    const key = `${r.ml_promotion_id ?? ""}|${r.promotion_type ?? ""}|${r.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Linha de exibição a partir de item em campanha BANK/PIX (GET …/promotions/{id}/items). */
export function sellerPromotionDisplayRowFromBankCampaignItem(
  campaign: MlSellerCampaignRow,
  item: MlCampaignItemRow
): SellerPromotionDisplayRow {
  const raw: Record<string, unknown> = {
    type: "BANK",
    sub_type: "COFINANCED",
    payment_method: "PIX",
    name: campaign.name,
    id: campaign.id,
    promotion_id: campaign.id,
    status: item.status,
    original_price: item.original_price,
    price: item.price,
    meli_percentage: item.meli_percentage,
    seller_percentage: item.seller_percentage,
    offer_id: item.offer_id,
    start_date: campaign.start_date,
    finish_date: campaign.finish_date,
  };
  const promoPrice = getSellerPromotionPriceAmount(raw);
  const label = formatSellerPromotionTitle(raw);
  return {
    label,
    original_price: item.original_price,
    promo_price: promoPrice,
    value_hint: getSellerPromotionValueHint(raw, promoPrice),
    meli_fee_subsidy: getSellerPromotionMeliFeeSubsidyBrl(raw),
    promotion_type: "BANK",
    ml_promotion_id: campaign.id,
    campaign_start_at: campaign.start_date,
    campaign_finish_at: campaign.finish_date,
  };
}

export function partitionSellerPromotionRowByStatus(
  row: SellerPromotionDisplayRow,
  itemStatus: string
): "active" | "possible" {
  const s = itemStatus.toLowerCase();
  if (s === "candidate") return "possible";
  if (s === "started" || s === "active" || s === "pending" || s === "programmed") return "active";
  return "possible";
}

export { mergePromotionDisplayRows };

export function formatSellerPromotionLine(p: Record<string, unknown>): string {
  const code = getSellerPromotionTypeCode(p);
  const nameRaw = String(p.name ?? "").trim();
  const name = nameRaw || (code ?? "Promoção");
  const typ = code && nameRaw ? ` · ${code}` : "";
  return `${name}${typ} — ${formatPromotionValuePart(p)}`;
}

/** Texto multilinha para gravar em pricing_cache.ml_active_promotions (uma promo por linha). */
export function buildMlActivePromotionsStorageText(raw: unknown): string {
  const list = normalizeSellerPromotionsList(raw).filter(isActiveSellerPromotion);
  if (list.length === 0) return "";
  return list.map(formatSellerPromotionLine).join("\n");
}

/** Linhas não vazias para UI. */
export function splitMlActivePromotionsCell(stored: string | null | undefined): string[] {
  if (!stored?.trim()) return [];
  return stored
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
