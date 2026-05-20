import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { fetchSellerPromotionsForItem, runWithConcurrency } from "@/lib/mercadolivre/client";
import {
  collectPromotionsByItemFromAllCampaigns,
  fetchBankPixPromotionRowsForItem,
  listBankPixCampaignsForUser,
  type ItemPromotionsFromCampaigns,
  type MlSellerCampaignRow,
} from "@/lib/mercadolivre/fetch-seller-campaigns";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import {
  mergePromotionDisplayRows,
  partitionSellerPromotionsRich,
  type SellerPromotionDisplayRow,
} from "@/lib/mercadolivre/seller-promotions-item";
import { computeItemsFees, type PricingFeeInputItem } from "@/lib/pricing/compute-items-fees";
import { calculateFullPricing } from "@/lib/pricing/full-net";
import { PRICING_CALCULATE_CLIENT_BATCH_SIZE } from "@/lib/pricing/calculate-limits";
import {
  buildMlActivePromotionsMapFromFlatPromoRows,
  patchPricingCacheMlActivePromotions,
} from "@/lib/mercadolivre/ml-active-promotions-from-cache";
import {
  inferPromotionTypeFromAnyLabelText,
  normalizeMlPromotionTypeCode,
} from "@/lib/mercadolivre/ml-promotion-types";
import { resolveMlItemIdsByProductTagIds } from "@/lib/product-tags";

export const PROMOTIONS_OVERVIEW_PAGE_SIZE = 12;
const ML_ENRICH_CONCURRENCY = 3;

function formatPostgrestError(prefix: string, err: PostgrestError | null | undefined): string {
  if (!err) return prefix;
  const bits = [err.message, err.code ? `código ${err.code}` : "", err.details, err.hint].filter(Boolean);
  return bits.length ? `${prefix}: ${bits.join(" — ")}` : prefix;
}

/** Mensagem amigável quando o Postgres indica DDL desatualizado em produção. */
function appendPromotionsSchemaHint(msg: string): string {
  const m = msg.toLowerCase();
  if (
    m.includes("does not exist") ||
    m.includes("não existe") ||
    m.includes("relation") ||
    m.includes("42p01") ||
    (m.includes("column") && (m.includes("not exist") || m.includes("does not")))
  ) {
    return `${msg} Se o erro citar tabela ou coluna inexistente, execute no Supabase as migrations 019_ml_promotion_webhook_alerts.sql, 020_promotions_cache.sql, 021_promotions_cache_link_filter.sql, 022_promotions_cache_promotion_type.sql, 023_promotions_cache_campaign_dates.sql, 024_promotions_cache_ml_promotion_id.sql e 025_promotions_cache_meli_fee_subsidy.sql.`;
  }
  return msg;
}

/** Remove linhas de anúncios que saíram do recorte atual (search + vínculo), após regravar todas as páginas. */
async function pruneStalePromotionsCacheRows(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  norm: string,
  linkKey: PromotionsLinkFilter,
  keptItemIds: Set<string>
) {
  const { data, error } = await supabase
    .from("promotions_cache_rows")
    .select("item_id")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .eq("cache_search", norm)
    .eq("cache_link_filter", linkKey);
  if (error) {
    console.error("[promotions-cache] prune list", error);
    throw new Error(appendPromotionsSchemaHint(formatPostgrestError("Erro ao listar cache de promoções para limpeza", error)));
  }
  const stale = new Set<string>();
  for (const row of data ?? []) {
    const id = String((row as { item_id?: string }).item_id ?? "").trim();
    if (!id || keptItemIds.has(id)) continue;
    stale.add(id);
  }
  const staleArr = Array.from(stale);
  const chunkSize = 80;
  for (let i = 0; i < staleArr.length; i += chunkSize) {
    const chunk = staleArr.slice(i, i + chunkSize);
    const { error: delErr } = await supabase
      .from("promotions_cache_rows")
      .delete()
      .eq("account_id", accountId)
      .eq("user_id", userId)
      .eq("cache_search", norm)
      .eq("cache_link_filter", linkKey)
      .in("item_id", chunk);
    if (delErr) {
      console.error("[promotions-cache] prune delete", delErr);
      throw new Error(appendPromotionsSchemaHint(formatPostgrestError("Erro ao remover cache de promoções obsoleto", delErr)));
    }
  }
}

/** Igual à tela Preços: `ml_items.product_id` (vínculo SKU → produto). */
export type PromotionsLinkFilter = "all" | "linked" | "unlinked";

export function parsePromotionsLinkFilter(linkedParam: string | null | undefined): PromotionsLinkFilter {
  const v = linkedParam?.trim();
  if (v === "1") return "linked";
  if (v === "0") return "unlinked";
  return "all";
}

/** Fase temporal da campanha (datas no cache). */
export type PromotionCampaignPhase = "in" | "future" | "past" | "nodates";

/** Filtros opcionais na leitura do cache (tipo de promoção e faixa de lucratividade). */
export type PromotionsOverviewExtraFilters = {
  promotionKind?: "" | "ativa" | "possível";
  profit?: "" | "high" | "medium" | "low" | "negative";
  /** Código `type` do ML (ex.: DEAL). Vazio = todos. */
  promotionType?: string;
  /** Fase da campanha pelas datas salvas (`camp` na URL). Vazio = todas. */
  campaignPhase?: "" | PromotionCampaignPhase;
  /** Somente linhas com PMA (produto vinculado) ≤ preço promoção. */
  pmaLtePromoPrice?: boolean;
  /** Tags do produto vinculado (OR): filtra por `item_id` do MLB. */
  tagIds?: string[];
};

/** PMA do cadastro de produtos ≤ preço na promoção (ambos > 0). */
export function rowMatchesPmaLtePromoPrice(row: {
  pma: number | null;
  promo_price: number | null;
}): boolean {
  const pma = row.pma;
  const promo = row.promo_price;
  if (pma == null || !Number.isFinite(pma) || pma <= 0) return false;
  if (promo == null || !Number.isFinite(promo) || promo <= 0) return false;
  return pma <= promo;
}

function parseCampaignPhaseParam(raw: string | null | undefined): "" | PromotionCampaignPhase {
  const v = raw?.trim().toLowerCase() ?? "";
  if (v === "in" || v === "vigente" || v === "ativa_campanha") return "in";
  if (v === "future" || v === "futura" || v === "agendada") return "future";
  if (v === "past" || v === "encerrada" || v === "fim") return "past";
  if (v === "nodates" || v === "sem_data" || v === "semdata") return "nodates";
  return "";
}

export function parsePromotionsOverviewFilters(searchParams: {
  get: (key: string) => string | null;
}): PromotionsOverviewExtraFilters {
  const kindRaw = searchParams.get("kind")?.trim() ?? "";
  const promotionKind =
    kindRaw === "ativa" || kindRaw === "possível" ? (kindRaw as "ativa" | "possível") : "";
  const profitRaw = searchParams.get("profit")?.trim() ?? "";
  const profit =
    profitRaw === "high" || profitRaw === "medium" || profitRaw === "low" || profitRaw === "negative"
      ? (profitRaw as NonNullable<PromotionsOverviewExtraFilters["profit"]>)
      : "";
  const ptypeNorm = normalizeMlPromotionTypeCode(searchParams.get("ptype"));
  const promotionType =
    ptypeNorm && /^[A-Z][A-Z0-9_]{0,63}$/.test(ptypeNorm) ? ptypeNorm : "";
  const campaignPhase = parseCampaignPhaseParam(searchParams.get("camp"));
  const pmaRaw = searchParams.get("pmaok")?.trim() ?? searchParams.get("pma_lte")?.trim() ?? "";
  const pmaLtePromoPrice = pmaRaw === "1" || pmaRaw === "true" || pmaRaw === "sim";
  const tagsRaw = searchParams.get("tags")?.trim() ?? "";
  const tagIds = tagsRaw
    ? tagsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  return { promotionKind, profit, promotionType, campaignPhase, pmaLtePromoPrice, tagIds };
}

function hasPromotionsOverviewExtraFilters(f?: PromotionsOverviewExtraFilters): boolean {
  return !!(
    f?.promotionKind ||
    f?.profit ||
    f?.promotionType ||
    f?.campaignPhase ||
    f?.pmaLtePromoPrice ||
    (f?.tagIds && f.tagIds.length > 0)
  );
}

function parseTimestampMs(v: unknown): number | null {
  if (v == null || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** Fase da campanha a partir das colunas persistidas (relógio do servidor). */
export function promotionCampaignPhaseFromCacheRow(
  row: Record<string, unknown>,
  nowMs: number = Date.now()
): PromotionCampaignPhase {
  const s = parseTimestampMs(row.campaign_start_at);
  const e = parseTimestampMs(row.campaign_finish_at);
  const hasS = s != null;
  const hasE = e != null;
  if (!hasS && !hasE) return "nodates";
  if (hasS && hasE && s! > e!) return "nodates";
  if (hasS && nowMs < s!) return "future";
  if (hasE && nowMs > e!) return "past";
  return "in";
}

/** Resolve tipo de campanha para filtro: coluna persistida ou inferência a partir de `promotion_label`. */
function resolvedPromotionTypeFromCacheRow(row: Record<string, unknown>): string | null {
  const fromCol =
    row.promotion_type != null && String(row.promotion_type).trim() !== ""
      ? normalizeMlPromotionTypeCode(String(row.promotion_type))
      : null;
  if (fromCol) return fromCol;
  return inferPromotionTypeFromAnyLabelText(String(row.promotion_label ?? ""));
}

function dedupePromotionCacheRowsByRowKey(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const rk = String(row.row_key);
    const prev = byKey.get(rk);
    const t = row.snapshot_at != null ? new Date(String(row.snapshot_at)).getTime() : 0;
    const pt = prev?.snapshot_at != null ? new Date(String(prev.snapshot_at)).getTime() : -1;
    if (!prev || t >= pt) byKey.set(rk, row);
  }
  return Array.from(byKey.values()).sort((a, b) => String(a.row_key).localeCompare(String(b.row_key)));
}

type MlItemRow = {
  item_id: string;
  title: string | null;
  status: string | null;
  price: number | string | null;
  thumbnail: string | null;
  permalink: string | null;
  updated_at: string;
  listing_type_id: string | null;
  category_id: string | null;
  product_id?: string | null;
};

type PromoCacheSliceKey = {
  cache_search: string;
  cache_link_filter: PromotionsLinkFilter;
  cache_page: number;
};

function itemMatchesPromotionsLinkFilter(
  row: Pick<MlItemRow, "product_id">,
  linkKey: PromotionsLinkFilter
): boolean {
  if (linkKey === "linked") return row.product_id != null;
  if (linkKey === "unlinked") return row.product_id == null;
  return true;
}

function sliceKeyString(s: PromoCacheSliceKey): string {
  return `${s.cache_search}\0${s.cache_link_filter}\0${s.cache_page}`;
}

type CacheRow = {
  item_id: string;
  variation_id: number | string;
  cost_price: number | string | null;
  weight_kg: number | string | null;
  height_cm: number | string | null;
  width_cm: number | string | null;
  length_cm: number | string | null;
  tax_percent: number | string | null;
  extra_fee_percent: number | string | null;
  fixed_expenses: number | string | null;
};

function pickPricingCacheRowForItem(caches: CacheRow[], itemId: string): CacheRow | null {
  const forItem = caches.filter((c) => c.item_id === itemId);
  if (forItem.length === 0) return null;
  const itemLevel = forItem.find((c) => Number(c.variation_id) === -1);
  return itemLevel ?? forItem[0];
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type PromoOverviewEnrichedRow = {
  item_id: string;
  title: string | null;
  status: string | null;
  thumbnail: string | null;
  permalink: string | null;
  updated_at: string;
  listing_type_id: string | null;
  category_id: string | null;
  list_price: number | null;
  active_price: number | null;
  active_promotions: SellerPromotionDisplayRow[];
  possible_promotions: SellerPromotionDisplayRow[];
  promotions_api_failed: boolean;
  cost_price: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
};

type FlatPromoInternal = {
  rowKey: string;
  item_id: string;
  title: string | null;
  status: string | null;
  thumbnail: string | null;
  permalink: string | null;
  updated_at: string;
  listing_type_id: string | null;
  category_id: string | null;
  list_price: number | null;
  active_price: number | null;
  promotions_api_failed: boolean;
  promotion_kind: "ativa" | "possível" | "—";
  promotion_label: string;
  promo_price: number | null;
  value_hint: string | null;
  cost_price: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  meli_fee_subsidy: number | null;
  promotion_type: string | null;
  campaign_start_at: string | null;
  campaign_finish_at: string | null;
  /** `id` do ML (seller-promotions); null na linha placeholder. */
  ml_promotion_id: string | null;
};

/** Chave estável no cache: item + ativa/possível + id ML (ou fallback por índice). */
function buildPromotionCacheRowKey(
  itemId: string,
  kind: "ativa" | "possível" | "—",
  mlPromotionId: string | null,
  index: number
): string {
  if (kind === "—") return `${itemId}||empty`;
  const seg = kind === "ativa" ? "A" : "P";
  const idPart =
    mlPromotionId != null && mlPromotionId.trim() !== ""
      ? mlPromotionId.trim()
      : `noid#${index}`;
  return `${itemId}|${seg}|${idPart}`;
}

function flattenPromoRows(enriched: PromoOverviewEnrichedRow[]): FlatPromoInternal[] {
  const out: FlatPromoInternal[] = [];
  for (const r of enriched) {
    const base = {
      item_id: r.item_id,
      title: r.title,
      status: r.status,
      thumbnail: r.thumbnail,
      permalink: r.permalink,
      updated_at: r.updated_at,
      listing_type_id: r.listing_type_id,
      category_id: r.category_id,
      list_price: r.list_price,
      active_price: r.active_price,
      promotions_api_failed: r.promotions_api_failed,
      cost_price: r.cost_price,
      weight_kg: r.weight_kg,
      height_cm: r.height_cm,
      width_cm: r.width_cm,
      length_cm: r.length_cm,
      tax_percent: r.tax_percent,
      extra_fee_percent: r.extra_fee_percent,
      fixed_expenses: r.fixed_expenses,
    };
    const actives = r.active_promotions ?? [];
    const poss = r.possible_promotions ?? [];
    if (actives.length === 0 && poss.length === 0) {
      out.push({
        ...base,
        active_price:
          r.list_price != null && Number.isFinite(r.list_price) && r.list_price > 0
            ? r.list_price
            : null,
        promotion_kind: "—",
        promotion_label: r.promotions_api_failed
          ? "Erro ao consultar promoções no ML"
          : "Nenhuma promoção listada para este anúncio",
        promo_price: null,
        value_hint: null,
        meli_fee_subsidy: null,
        promotion_type: null,
        campaign_start_at: null,
        campaign_finish_at: null,
        ml_promotion_id: null,
        rowKey: buildPromotionCacheRowKey(r.item_id, "—", null, 0),
      });
      continue;
    }
    actives.forEach((slice, i) => {
      out.push({
        ...base,
        active_price: slice.original_price,
        promotion_kind: "ativa",
        promotion_label: slice.label,
        promo_price: slice.promo_price,
        value_hint: slice.value_hint,
        meli_fee_subsidy: slice.meli_fee_subsidy,
        promotion_type: slice.promotion_type,
        campaign_start_at: slice.campaign_start_at,
        campaign_finish_at: slice.campaign_finish_at,
        ml_promotion_id: slice.ml_promotion_id,
        rowKey: buildPromotionCacheRowKey(r.item_id, "ativa", slice.ml_promotion_id, i),
      });
    });
    poss.forEach((slice, i) => {
      out.push({
        ...base,
        active_price: slice.original_price,
        promotion_kind: "possível",
        promotion_label: slice.label,
        promo_price: slice.promo_price,
        value_hint: slice.value_hint,
        meli_fee_subsidy: slice.meli_fee_subsidy,
        promotion_type: slice.promotion_type,
        campaign_start_at: slice.campaign_start_at,
        campaign_finish_at: slice.campaign_finish_at,
        ml_promotion_id: slice.ml_promotion_id,
        rowKey: buildPromotionCacheRowKey(r.item_id, "possível", slice.ml_promotion_id, i),
      });
    });
  }
  return out;
}

export type PromoOverviewFlatApiRow = {
  item_id: string;
  title: string | null;
  status: string | null;
  thumbnail: string | null;
  permalink: string | null;
  updated_at: string;
  listing_type_id: string | null;
  category_id: string | null;
  list_price: number | null;
  active_price: number | null;
  promotions_api_failed: boolean;
  promotionKind: "ativa" | "possível" | "—";
  promotionLabel: string;
  /** Código `type` retornado pelo ML (seller-promotions). */
  promotionType: string | null;
  /** Início da campanha (ISO), quando o ML informar. */
  campaign_start_at: string | null;
  /** Fim da campanha (ISO), quando o ML informar. */
  campaign_finish_at: string | null;
  /** `id` da promoção/campanha no ML (seller-promotions). */
  ml_promotion_id: string | null;
  promo_price: number | null;
  value_hint: string | null;
  rowKey: string;
  cost_price: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  pricing: {
    price: number;
    fee: number;
    shipping_cost: number;
    tax_amount: number;
    extra_fee_amount: number;
    fixed_expenses_amount: number;
    meli_fee_subsidy: number;
    vai_receber: number;
    net_amount: number;
  } | null;
  profit: number | null;
  profit_percent: number | null;
  /** PMA (R$) do produto vinculado (`products.pma` via `ml_items.product_id`). */
  pma: number | null;
};

function mapFlatToApi(
  f: FlatPromoInternal,
  pricing: ReturnType<typeof calculateFullPricing> | null,
  profit: number | null,
  profitPercent: number | null
): PromoOverviewFlatApiRow {
  return {
    item_id: f.item_id,
    title: f.title,
    status: f.status,
    thumbnail: f.thumbnail,
    permalink: f.permalink,
    updated_at: f.updated_at,
    listing_type_id: f.listing_type_id,
    category_id: f.category_id,
    list_price: f.list_price,
    active_price: f.active_price,
    promotions_api_failed: f.promotions_api_failed,
    promotionKind: f.promotion_kind,
    promotionLabel: f.promotion_label,
    promotionType: f.promotion_type,
    campaign_start_at: f.campaign_start_at,
    campaign_finish_at: f.campaign_finish_at,
    ml_promotion_id: f.ml_promotion_id,
    promo_price: f.promo_price,
    value_hint: f.value_hint,
    rowKey: f.rowKey,
    cost_price: f.cost_price,
    weight_kg: f.weight_kg,
    height_cm: f.height_cm,
    width_cm: f.width_cm,
    length_cm: f.length_cm,
    tax_percent: f.tax_percent,
    extra_fee_percent: f.extra_fee_percent,
    fixed_expenses: f.fixed_expenses,
    pricing: pricing
      ? {
          price: pricing.price,
          fee: pricing.fee,
          shipping_cost: pricing.shipping_cost,
          tax_amount: pricing.tax_amount,
          extra_fee_amount: pricing.extra_fee_amount,
          fixed_expenses_amount: pricing.fixed_expenses_amount,
          meli_fee_subsidy: pricing.meli_fee_subsidy,
          vai_receber: pricing.vai_receber,
          net_amount: pricing.net_amount,
        }
      : null,
    profit,
    profit_percent: profitPercent,
    pma: null,
  };
}

function normalizeCacheSearch(search: string): string {
  return search.trim();
}

/** Lista `item_id` da página atual de `ml_items` (mesmo filtro de busca e vínculo que o refresh). */
async function fetchMlItemIdsPage(
  supabase: SupabaseClient,
  accountId: string,
  norm: string,
  linkKey: PromotionsLinkFilter,
  cachePage: number,
  allowedItemIds?: string[] | null
): Promise<string[]> {
  const from = (cachePage - 1) * PROMOTIONS_OVERVIEW_PAGE_SIZE;
  const to = from + PROMOTIONS_OVERVIEW_PAGE_SIZE - 1;
  let q = supabase.from("ml_items").select("item_id").eq("account_id", accountId);
  if (linkKey === "linked") q = q.not("product_id", "is", null);
  else if (linkKey === "unlinked") q = q.is("product_id", null);
  if (allowedItemIds) {
    if (allowedItemIds.length === 0) return [];
    q = q.in("item_id", allowedItemIds);
  }
  if (norm) {
    q = q.or(`title.ilike.%${norm}%,item_id.ilike.%${norm}%`);
  }
  const { data, error } = await q.order("updated_at", { ascending: false }).range(from, to);
  if (error) {
    console.error("[promotions-cache] fetchMlItemIdsPage", error);
    return [];
  }
  const ids = (data ?? []).map((r) => String((r as { item_id: string }).item_id));
  return Array.from(new Set(ids));
}

function isoFromDbTimestamp(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === "") return null;
  const d = new Date(String(raw));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function mapPromotionCacheDbRowToApi(row: Record<string, unknown>): PromoOverviewFlatApiRow {
  const promotionKind = String(row.promotion_kind) as "ativa" | "possível" | "—";
  const hasPricing = row.net_amount != null && Number.isFinite(Number(row.net_amount));

  const meliSubsidy =
    row.meli_fee_subsidy != null && Number.isFinite(Number(row.meli_fee_subsidy))
      ? Math.max(0, Number(row.meli_fee_subsidy))
      : 0;

  const pricing = hasPricing
    ? {
        price: Number(row.promo_price ?? row.active_price ?? 0),
        fee: row.fee != null ? Number(row.fee) : 0,
        shipping_cost: row.shipping_cost != null ? Number(row.shipping_cost) : 0,
        tax_amount: Number(row.tax_amount ?? 0),
        extra_fee_amount: Number(row.extra_fee_amount ?? 0),
        fixed_expenses_amount: Number(row.fixed_expenses_amount ?? 0),
        meli_fee_subsidy: meliSubsidy,
        net_amount: Number(row.net_amount),
        vai_receber:
          Math.round(
            (Number(row.net_amount) +
              Number(row.tax_amount ?? 0) +
              Number(row.extra_fee_amount ?? 0) +
              Number(row.fixed_expenses_amount ?? 0)) *
              100
          ) / 100,
      }
    : null;

  const profit = row.profit != null && Number.isFinite(Number(row.profit)) ? Number(row.profit) : null;
  const profitPercent =
    row.profit_percent != null && Number.isFinite(Number(row.profit_percent))
      ? Number(row.profit_percent)
      : null;

  return {
    item_id: String(row.item_id),
    title: row.title != null ? String(row.title) : null,
    status: row.status != null ? String(row.status) : null,
    thumbnail: row.thumbnail != null ? String(row.thumbnail) : null,
    permalink: row.permalink != null ? String(row.permalink) : null,
    updated_at: row.updated_at != null ? String(row.updated_at) : "",
    listing_type_id: row.listing_type_id != null ? String(row.listing_type_id) : null,
    category_id: row.category_id != null ? String(row.category_id) : null,
    list_price: row.list_price != null ? Number(row.list_price) : null,
    active_price: row.active_price != null ? Number(row.active_price) : null,
    promotions_api_failed: Boolean(row.promotions_api_failed),
    promotionKind,
    promotionLabel: String(row.promotion_label ?? ""),
    promotionType:
      row.promotion_type != null && String(row.promotion_type).trim() !== ""
        ? normalizeMlPromotionTypeCode(String(row.promotion_type))
        : inferPromotionTypeFromAnyLabelText(String(row.promotion_label ?? "")),
    campaign_start_at: isoFromDbTimestamp(row.campaign_start_at),
    campaign_finish_at: isoFromDbTimestamp(row.campaign_finish_at),
    ml_promotion_id:
      row.ml_promotion_id != null && String(row.ml_promotion_id).trim() !== ""
        ? String(row.ml_promotion_id).trim()
        : null,
    promo_price: row.promo_price != null ? Number(row.promo_price) : null,
    value_hint: row.value_hint != null ? String(row.value_hint) : null,
    rowKey: String(row.row_key),
    cost_price: row.cost_price != null ? Number(row.cost_price) : null,
    weight_kg: row.weight_kg != null ? Number(row.weight_kg) : null,
    height_cm: row.height_cm != null ? Number(row.height_cm) : null,
    width_cm: row.width_cm != null ? Number(row.width_cm) : null,
    length_cm: row.length_cm != null ? Number(row.length_cm) : null,
    tax_percent: row.tax_percent != null ? Number(row.tax_percent) : null,
    extra_fee_percent: row.extra_fee_percent != null ? Number(row.extra_fee_percent) : null,
    fixed_expenses: row.fixed_expenses != null ? Number(row.fixed_expenses) : null,
    pricing,
    profit,
    profit_percent: profitPercent,
    pma: null,
  };
}

/** Anexa `products.pma` do SKU vinculado ao anúncio (`ml_items.product_id`). */
export async function attachPmaToPromoOverviewRows(
  supabase: SupabaseClient,
  accountId: string,
  rows: PromoOverviewFlatApiRow[]
): Promise<PromoOverviewFlatApiRow[]> {
  if (rows.length === 0) return rows;

  const itemIds = Array.from(new Set(rows.map((r) => String(r.item_id).trim()).filter(Boolean)));
  if (itemIds.length === 0) return rows.map((r) => ({ ...r, pma: null }));

  const { data: mlItems, error: mlErr } = await supabase
    .from("ml_items")
    .select("item_id, product_id")
    .eq("account_id", accountId)
    .in("item_id", itemIds);

  if (mlErr) {
    console.warn("[promotions-cache] attachPma ml_items", mlErr);
    return rows.map((r) => ({ ...r, pma: null }));
  }

  const productIds = Array.from(
    new Set(
      (mlItems ?? [])
        .map((row) => (row as { product_id?: string | null }).product_id)
        .filter((id): id is string => id != null && String(id).trim() !== "")
    )
  );

  const pmaByProductId = new Map<string, number>();
  if (productIds.length > 0) {
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id, pma")
      .in("id", productIds);
    if (prodErr) {
      console.warn("[promotions-cache] attachPma products", prodErr);
    } else {
      for (const p of products ?? []) {
        const id = String((p as { id?: string }).id ?? "");
        const pma = Number((p as { pma?: number | string | null }).pma);
        if (id && Number.isFinite(pma) && pma > 0) pmaByProductId.set(id, pma);
      }
    }
  }

  const pmaByItemId = new Map<string, number | null>();
  for (const row of mlItems ?? []) {
    const itemId = String((row as { item_id?: string }).item_id ?? "").trim();
    const productId = (row as { product_id?: string | null }).product_id;
    if (!itemId) continue;
    if (productId == null || String(productId).trim() === "") {
      pmaByItemId.set(itemId, null);
      continue;
    }
    const pma = pmaByProductId.get(String(productId)) ?? null;
    pmaByItemId.set(itemId, pma);
  }

  return rows.map((r) => ({
    ...r,
    pma: pmaByItemId.get(String(r.item_id).trim()) ?? null,
  }));
}

export async function countMlItemsForPromotionsPage(
  supabase: SupabaseClient,
  accountId: string,
  search: string,
  linkFilter: PromotionsLinkFilter = "all",
  allowedItemIds?: string[] | null
): Promise<number> {
  const norm = normalizeCacheSearch(search);
  let q = supabase
    .from("ml_items")
    .select("item_id", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (linkFilter === "linked") q = q.not("product_id", "is", null);
  else if (linkFilter === "unlinked") q = q.is("product_id", null);
  if (allowedItemIds) {
    if (allowedItemIds.length === 0) return 0;
    q = q.in("item_id", allowedItemIds);
  }
  if (norm) {
    q = q.or(`title.ilike.%${norm}%,item_id.ilike.%${norm}%`);
  }
  const { count, error } = await q;
  if (error) {
    console.error("[promotions-cache] count ml_items", error);
    return 0;
  }
  return count ?? 0;
}

export async function readPromotionsCache(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  page: number,
  search: string,
  linkFilter: PromotionsLinkFilter = "all",
  extraFilters?: PromotionsOverviewExtraFilters
): Promise<{
  rows: PromoOverviewFlatApiRow[];
  total: number;
  snapshot_at: string | null;
}> {
  const norm = normalizeCacheSearch(search);
  const cachePage = Math.max(1, page);
  const linkKey: PromotionsLinkFilter = linkFilter;

  const tagIds = extraFilters?.tagIds ?? [];
  let allowedItemIds: string[] | null = null;
  if (tagIds.length > 0) {
    const resolved = await resolveMlItemIdsByProductTagIds(supabase, accountId, tagIds);
    allowedItemIds = resolved ?? [];
    if (allowedItemIds.length === 0) {
      return { rows: [], total: 0, snapshot_at: null };
    }
  }

  const filterRowsByTags = (rows: PromoOverviewFlatApiRow[]) => {
    if (!allowedItemIds) return rows;
    const set = new Set(allowedItemIds.map((id) => id.trim().toUpperCase()));
    return rows.filter((r) => set.has(String(r.item_id).trim().toUpperCase()));
  };

  if (hasPromotionsOverviewExtraFilters(extraFilters)) {
    const buildFilteredSelect = () => {
      let qq = supabase
        .from("promotions_cache_rows")
        .select("*")
        .eq("account_id", accountId)
        .eq("user_id", userId)
        .eq("cache_link_filter", linkKey);

      if (extraFilters!.promotionKind === "ativa") {
        qq = qq.eq("promotion_kind", "ativa");
      } else if (extraFilters!.promotionKind === "possível") {
        qq = qq.eq("promotion_kind", "possível");
      }

      const profit = extraFilters!.profit;
      if (profit === "high") {
        qq = qq.gt("profit_percent", 20).not("profit_percent", "is", null);
      } else if (profit === "medium") {
        qq = qq.gt("profit_percent", 10).lte("profit_percent", 20).not("profit_percent", "is", null);
      } else if (profit === "low") {
        qq = qq.gt("profit_percent", 0).lte("profit_percent", 10).not("profit_percent", "is", null);
      } else if (profit === "negative") {
        qq = qq.lte("profit_percent", 0).not("profit_percent", "is", null);
      }
      return qq;
    };

    const ptype = extraFilters!.promotionType;
    const campPhase = extraFilters!.campaignPhase;

    const pageItemIds = await fetchMlItemIdsPage(
      supabase,
      accountId,
      norm,
      linkKey,
      cachePage,
      allowedItemIds
    );

    /**
     * Sem filtro por tipo no SQL, `.limit(8000)` cortava linhas válidas: o filtro `ptype` era só em memória
     * sobre um subconjunto arbitrário (ordem `row_key`). Com `ptype`, buscamos no banco pelo tipo e
     * complementamos linhas sem coluna preenchida cuja inferência pelo rótulo bate com `ptype`.
     */
    let fromSearch: Record<string, unknown>[] = [];
    if (ptype) {
      const typedRes = await buildFilteredSelect()
        .eq("cache_search", norm)
        .eq("promotion_type", ptype)
        .order("row_key", { ascending: true })
        .limit(100_000);
      if (typedRes.error) {
        console.error("[promotions-cache] read filtered (ptype)", typedRes.error);
        return { rows: [], total: 0, snapshot_at: null };
      }
      fromSearch.push(...((typedRes.data ?? []) as Record<string, unknown>[]));

      const nullRes = await buildFilteredSelect()
        .eq("cache_search", norm)
        .is("promotion_type", null)
        .order("row_key", { ascending: true })
        .limit(25_000);
      if (!nullRes.error && nullRes.data?.length) {
        for (const row of nullRes.data as Record<string, unknown>[]) {
          if (resolvedPromotionTypeFromCacheRow(row) === ptype) fromSearch.push(row);
        }
      }

      const emptyRes = await buildFilteredSelect()
        .eq("cache_search", norm)
        .eq("promotion_type", "")
        .order("row_key", { ascending: true })
        .limit(5_000);
      if (!emptyRes.error && emptyRes.data?.length) {
        for (const row of emptyRes.data as Record<string, unknown>[]) {
          if (resolvedPromotionTypeFromCacheRow(row) === ptype) fromSearch.push(row);
        }
      }

      fromSearch = dedupePromotionCacheRowsByRowKey(fromSearch);
    } else {
      const wideLimit = campPhase ? 50_000 : 8_000;
      const searchRes = await buildFilteredSelect()
        .eq("cache_search", norm)
        .order("row_key", { ascending: true })
        .limit(wideLimit);
      if (searchRes.error) {
        console.error("[promotions-cache] read filtered", searchRes.error);
        return { rows: [], total: 0, snapshot_at: null };
      }
      fromSearch = (searchRes.data ?? []) as Record<string, unknown>[];
    }

    let fromPage: Record<string, unknown>[] = [];
    if (pageItemIds.length > 0) {
      const pageLimit = ptype || campPhase ? 12_000 : 4_000;
      const pageRes = await buildFilteredSelect()
        .in("item_id", pageItemIds)
        .order("row_key", { ascending: true })
        .limit(pageLimit);
      if (pageRes.error) {
        console.error("[promotions-cache] read filtered (itens da página)", pageRes.error);
      } else {
        fromPage = (pageRes.data ?? []) as Record<string, unknown>[];
      }
    }

    const merged = [...fromSearch, ...fromPage];
    let deduped = dedupePromotionCacheRowsByRowKey(merged);
    if (ptype) {
      deduped = deduped.filter((row) => resolvedPromotionTypeFromCacheRow(row) === ptype);
    }
    if (campPhase) {
      deduped = deduped.filter((row) => promotionCampaignPhaseFromCacheRow(row) === campPhase);
    }

    let apiRows: PromoOverviewFlatApiRow[] = deduped.map(mapPromotionCacheDbRowToApi);
    apiRows = await attachPmaToPromoOverviewRows(supabase, accountId, apiRows);
    apiRows = filterRowsByTags(apiRows);
    if (extraFilters!.pmaLtePromoPrice) {
      apiRows = apiRows.filter(rowMatchesPmaLtePromoPrice);
    }

    const totalFiltered = apiRows.length;
    const pageSize = PROMOTIONS_OVERVIEW_PAGE_SIZE;
    const fromIdx = (cachePage - 1) * pageSize;
    const pageSlice = apiRows.slice(fromIdx, fromIdx + pageSize);

    let snapshotAt: string | null =
      deduped[0]?.snapshot_at != null ? String(deduped[0].snapshot_at) : null;
    for (const row of deduped) {
      if (row.snapshot_at == null) continue;
      const s = String(row.snapshot_at);
      if (!snapshotAt || s > snapshotAt) snapshotAt = s;
    }

    return { rows: pageSlice, total: totalFiltered, snapshot_at: snapshotAt };
  }

  const total = await countMlItemsForPromotionsPage(
    supabase,
    accountId,
    norm,
    linkKey,
    allowedItemIds
  );

  const { data: cached, error } = await supabase
    .from("promotions_cache_rows")
    .select("*")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .eq("cache_page", cachePage)
    .eq("cache_search", norm)
    .eq("cache_link_filter", linkKey)
    .order("row_key", { ascending: true });

  if (error) {
    console.error("[promotions-cache] read", error);
    return { rows: [], total, snapshot_at: null };
  }

  let list = (cached ?? []) as Record<string, unknown>[];

  /**
   * Cache é gravado por (cache_page, cache_search, …). Ao filtrar por MLB/título, a chave muda e não há linhas
   * novas até um POST — mas os mesmos anúncios já podem estar no banco sob outra `cache_search` (ex.: lista geral).
   * Reaproveita linhas por `item_id` dos anúncios desta página (mesmo critério `ml_items` que o total).
   */
  if (list.length === 0 && total > 0) {
    const pageItemIds = await fetchMlItemIdsPage(
      supabase,
      accountId,
      norm,
      linkKey,
      cachePage,
      allowedItemIds
    );
    if (pageItemIds.length > 0) {
      const { data: fb, error: fbErr } = await supabase
        .from("promotions_cache_rows")
        .select("*")
        .eq("account_id", accountId)
        .eq("user_id", userId)
        .eq("cache_link_filter", linkKey)
        .in("item_id", pageItemIds);
      if (!fbErr && fb?.length) {
        const byRowKey = new Map<string, Record<string, unknown>>();
        for (const row of fb as Record<string, unknown>[]) {
          const rk = String(row.row_key);
          const prev = byRowKey.get(rk);
          const t =
            row.snapshot_at != null ? new Date(String(row.snapshot_at)).getTime() : 0;
          const pt =
            prev?.snapshot_at != null ? new Date(String(prev.snapshot_at)).getTime() : -1;
          if (!prev || t >= pt) byRowKey.set(rk, row);
        }
        list = Array.from(byRowKey.values()).sort((a, b) =>
          String(a.row_key).localeCompare(String(b.row_key))
        );
      }
    }
  }

  /**
   * Anúncio pode não estar na 1ª página (ordenado por `updated_at`) e nunca ter sido incluído num sync da lista geral —
   * o fallback acima não acha linhas. Com texto de busca (MLB/título), busca no ML e grava como no POST.
   */
  if (list.length === 0 && total > 0 && norm) {
    try {
      const refreshed = await refreshPromotionsCache({
        supabase,
        accountId,
        userId,
        page: cachePage,
        search: norm,
        linkFilter: linkKey,
        refreshScope: "page",
      });
      return {
        rows: refreshed.rows,
        total: refreshed.total,
        snapshot_at: refreshed.snapshot_at,
      };
    } catch (e) {
      console.error("[promotions-cache] read: refresh após cache vazio (busca)", e);
      return { rows: [], total, snapshot_at: null };
    }
  }

  if (list.length === 0) {
    return { rows: [], total, snapshot_at: null };
  }

  let snapshotAt: string | null =
    list[0]?.snapshot_at != null ? String(list[0].snapshot_at) : null;
  for (const row of list) {
    if (row.snapshot_at == null) continue;
    const s = String(row.snapshot_at);
    if (!snapshotAt || s > snapshotAt) snapshotAt = s;
  }

  let rows: PromoOverviewFlatApiRow[] = list.map(mapPromotionCacheDbRowToApi);
  rows = await attachPmaToPromoOverviewRows(supabase, accountId, rows);
  rows = filterRowsByTags(rows);
  if (extraFilters?.pmaLtePromoPrice) {
    rows = rows.filter(rowMatchesPmaLtePromoPrice);
    return { rows, total: rows.length, snapshot_at: snapshotAt };
  }

  return { rows, total: allowedItemIds ? rows.length : total, snapshot_at: snapshotAt };
}

async function fetchIsMercadoLider(
  accessToken: string,
  mlUserId: number
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.mercadolibre.com/users/${mlUserId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { seller_reputation?: { power_seller_status?: string | null } };
    const power = data.seller_reputation?.power_seller_status?.toLowerCase() ?? "";
    return power === "gold" || power === "platinum";
  } catch {
    return false;
  }
}

/** Busca ML + taxas para uma lista de anúncios (sem gravar cache). */
async function enrichMlItemRowsToApiRows(ctx: {
  supabase: SupabaseClient;
  adminSupabase: SupabaseClient;
  accountId: string;
  siteId: string;
  accessToken: string;
  isMercadoLider: boolean;
  mlUserId: number | null;
  rows: MlItemRow[];
  /** Quando definido, usa promoções já coletadas via API de campanhas (sem GET por anúncio). */
  promotionMapByItemId?: Map<string, ItemPromotionsFromCampaigns>;
}): Promise<{ apiRows: PromoOverviewFlatApiRow[]; flat: FlatPromoInternal[]; itemIds: string[] }> {
  const {
    supabase,
    adminSupabase,
    accountId,
    siteId,
    accessToken,
    isMercadoLider,
    mlUserId,
    rows,
    promotionMapByItemId,
  } = ctx;
  let bankCampaignsCache: MlSellerCampaignRow[] | null = null;
  const loadBankCampaigns = async (): Promise<MlSellerCampaignRow[]> => {
    if (bankCampaignsCache) return bankCampaignsCache;
    if (mlUserId == null || !Number.isFinite(mlUserId)) {
      bankCampaignsCache = [];
      return bankCampaignsCache;
    }
    bankCampaignsCache = await listBankPixCampaignsForUser(mlUserId, accessToken);
    return bankCampaignsCache;
  };
  const itemIds = rows.map((r) => r.item_id);
  let cacheByItem = new Map<string, CacheRow | null>();

  if (itemIds.length > 0) {
    const { data: cacheRows, error: cacheErr } = await supabase
      .from("pricing_cache")
      .select(
        "item_id, variation_id, cost_price, weight_kg, height_cm, width_cm, length_cm, tax_percent, extra_fee_percent, fixed_expenses"
      )
      .eq("account_id", accountId)
      .in("item_id", itemIds);
    if (cacheErr) {
      console.error("[promotions-cache] pricing_cache", cacheErr);
    }
    const list = (cacheRows ?? []) as CacheRow[];
    for (const id of itemIds) {
      cacheByItem.set(id, pickPricingCacheRowForItem(list, id));
    }
  }

  const buildEnrichedRow = async (row: MlItemRow): Promise<PromoOverviewEnrichedRow> => {
    const itemId = row.item_id;
    const listPrice = row.price != null ? Number(row.price) : null;
    const cache = cacheByItem.get(itemId) ?? null;
    if (promotionMapByItemId) {
      const fromMap =
        promotionMapByItemId.get(String(itemId).trim().toUpperCase()) ?? {
          active: [],
          possible: [],
        };
      return {
        item_id: itemId,
        title: row.title,
        status: row.status,
        thumbnail: row.thumbnail,
        permalink: row.permalink,
        updated_at: row.updated_at,
        listing_type_id: row.listing_type_id,
        category_id: row.category_id,
        list_price: listPrice,
        active_price: null,
        active_promotions: fromMap.active,
        possible_promotions: fromMap.possible,
        promotions_api_failed: false,
        cost_price: cache ? num(cache.cost_price) : null,
        weight_kg: cache ? num(cache.weight_kg) : null,
        height_cm: cache ? num(cache.height_cm) : null,
        width_cm: cache ? num(cache.width_cm) : null,
        length_cm: cache ? num(cache.length_cm) : null,
        tax_percent: cache ? num(cache.tax_percent) : null,
        extra_fee_percent: cache ? num(cache.extra_fee_percent) : null,
        fixed_expenses: cache ? num(cache.fixed_expenses) : null,
      };
    }

    const promoRaw = await fetchSellerPromotionsForItem(itemId, accessToken);

    let { active, possible } = partitionSellerPromotionsRich(promoRaw);
    const hasBankInItemApi = [...active, ...possible].some((r) => r.promotion_type === "BANK");
    if (!hasBankInItemApi) {
      try {
        const bankRows = await fetchBankPixPromotionRowsForItem(
          itemId,
          accessToken,
          await loadBankCampaigns()
        );
        active = mergePromotionDisplayRows(active, bankRows.active);
        possible = mergePromotionDisplayRows(possible, bankRows.possible);
      } catch (e) {
        console.warn("[promotions-cache] BANK/PIX supplement", itemId, e);
      }
    }
    const promotionsFailed = promoRaw === null && active.length === 0 && possible.length === 0;

    return {
      item_id: itemId,
      title: row.title,
      status: row.status,
      thumbnail: row.thumbnail,
      permalink: row.permalink,
      updated_at: row.updated_at,
      listing_type_id: row.listing_type_id,
      category_id: row.category_id,
      list_price: listPrice,
      active_price: null,
      active_promotions: active,
      possible_promotions: possible,
      promotions_api_failed: promotionsFailed,
      cost_price: cache ? num(cache.cost_price) : null,
      weight_kg: cache ? num(cache.weight_kg) : null,
      height_cm: cache ? num(cache.height_cm) : null,
      width_cm: cache ? num(cache.width_cm) : null,
      length_cm: cache ? num(cache.length_cm) : null,
      tax_percent: cache ? num(cache.tax_percent) : null,
      extra_fee_percent: cache ? num(cache.extra_fee_percent) : null,
      fixed_expenses: cache ? num(cache.fixed_expenses) : null,
    };
  };

  const enriched: PromoOverviewEnrichedRow[] = promotionMapByItemId
    ? await Promise.all(rows.map((row) => buildEnrichedRow(row)))
    : await runWithConcurrency(rows, ML_ENRICH_CONCURRENCY, (row) => buildEnrichedRow(row));

  const flat = flattenPromoRows(enriched);

  type FeeEntry = { flatIndex: number; item: PricingFeeInputItem };
  const feeEntries: FeeEntry[] = [];
  flat.forEach((f, flatIndex) => {
    if (f.promotion_kind === "—") return;
    if (f.promo_price == null || f.promo_price <= 0) return;
    if (!f.listing_type_id || !f.category_id) return;
    feeEntries.push({
      flatIndex,
      item: {
        item_id: f.item_id,
        variation_id: -1,
        price: f.promo_price,
        listing_type_id: f.listing_type_id,
        category_id: f.category_id,
        weight_kg: f.weight_kg,
        height_cm: f.height_cm,
        width_cm: f.width_cm,
        length_cm: f.length_cm,
      },
    });
  });

  const feeByFlatIndex = new Map<number, { fee: number; shipping_cost: number; price: number }>();
  for (let i = 0; i < feeEntries.length; i += PRICING_CALCULATE_CLIENT_BATCH_SIZE) {
    const chunk = feeEntries.slice(i, i + PRICING_CALCULATE_CLIENT_BATCH_SIZE);
    const { results } = await computeItemsFees(chunk.map((c) => c.item), {
      siteId,
      accessToken,
      isMercadoLider,
      supabaseAdmin: adminSupabase,
    });
    chunk.forEach((e, j) => {
      const r = results[j];
      if (r) {
        feeByFlatIndex.set(e.flatIndex, {
          fee: r.fee,
          shipping_cost: r.shipping_cost,
          price: r.price,
        });
      }
    });
  }

  const apiRows: PromoOverviewFlatApiRow[] = flat.map((f, flatIndex) => {
    const feeRow = feeByFlatIndex.get(flatIndex);
    let full: ReturnType<typeof calculateFullPricing> | null = null;
    if (feeRow) {
      full = calculateFullPricing(f.tax_percent, f.extra_fee_percent, f.fixed_expenses, {
        price: feeRow.price,
        fee: feeRow.fee,
        shipping_cost: feeRow.shipping_cost,
        meli_fee_subsidy: f.meli_fee_subsidy,
      });
    }
    const profit =
      full != null && f.cost_price != null ? Math.round((full.net_amount - f.cost_price) * 100) / 100 : null;
    const profitPercent =
      profit != null && f.promo_price != null && f.promo_price > 0
        ? Math.round(((profit / f.promo_price) * 100) * 10) / 10
        : null;
    return mapFlatToApi(f, full, profit, profitPercent);
  });

  return { apiRows, flat, itemIds };
}

async function persistPromoApiRowsToCacheSlice(ctx: {
  supabase: SupabaseClient;
  adminSupabase: SupabaseClient;
  accountId: string;
  userId: string;
  norm: string;
  linkKey: PromotionsLinkFilter;
  cachePage: number;
  snapshotAt: string;
  isMercadoLider: boolean;
  itemIds: string[];
  apiRows: PromoOverviewFlatApiRow[];
  flat: FlatPromoInternal[];
}): Promise<void> {
  const {
    supabase,
    adminSupabase,
    accountId,
    userId,
    norm,
    linkKey,
    cachePage,
    snapshotAt,
    isMercadoLider,
    itemIds,
    apiRows,
    flat,
  } = ctx;

  if (itemIds.length > 0) {
    const { error: delErr } = await supabase
      .from("promotions_cache_rows")
      .delete()
      .eq("account_id", accountId)
      .eq("user_id", userId)
      .eq("cache_search", norm)
      .eq("cache_link_filter", linkKey)
      .in("item_id", itemIds);
    if (delErr) {
      console.error("[promotions-cache] delete por item_id (sync ML)", delErr);
      throw new Error(appendPromotionsSchemaHint(formatPostgrestError("Erro ao limpar cache de promoções", delErr)));
    }
  }

  if (apiRows.length > 0) {
    const dbRows = apiRows.map((r) => ({
      account_id: accountId,
      user_id: userId,
      cache_page: cachePage,
      cache_search: norm,
      cache_link_filter: linkKey,
      row_key: r.rowKey,
      item_id: r.item_id,
      title: r.title,
      status: r.status,
      thumbnail: r.thumbnail,
      permalink: r.permalink,
      updated_at: r.updated_at || null,
      listing_type_id: r.listing_type_id,
      category_id: r.category_id,
      list_price: r.list_price,
      active_price: r.active_price,
      promotion_kind: r.promotionKind,
      promotion_label: r.promotionLabel,
      promotion_type: r.promotionType ?? null,
      campaign_start_at: r.campaign_start_at ?? null,
      campaign_finish_at: r.campaign_finish_at ?? null,
      ml_promotion_id: r.ml_promotion_id ?? null,
      promo_price: r.promo_price,
      value_hint: r.value_hint,
      promotions_api_failed: r.promotions_api_failed,
      cost_price: r.cost_price,
      weight_kg: r.weight_kg,
      height_cm: r.height_cm,
      width_cm: r.width_cm,
      length_cm: r.length_cm,
      tax_percent: r.tax_percent,
      extra_fee_percent: r.extra_fee_percent,
      fixed_expenses: r.fixed_expenses,
      fee: r.pricing?.fee ?? null,
      meli_fee_subsidy: r.pricing?.meli_fee_subsidy ?? null,
      shipping_cost: r.pricing?.shipping_cost ?? null,
      tax_amount: r.pricing?.tax_amount ?? null,
      extra_fee_amount: r.pricing?.extra_fee_amount ?? null,
      fixed_expenses_amount: r.pricing?.fixed_expenses_amount ?? null,
      net_amount: r.pricing?.net_amount ?? null,
      profit: r.profit,
      profit_percent: r.profit_percent,
      snapshot_at: snapshotAt,
      is_mercado_lider_snapshot: isMercadoLider,
    }));

    const chunkSize = 80;
    for (let i = 0; i < dbRows.length; i += chunkSize) {
      const slice = dbRows.slice(i, i + chunkSize);
      const { error: insErr } = await supabase.from("promotions_cache_rows").insert(slice);
      if (insErr) {
        console.error("[promotions-cache] insert", insErr);
        throw new Error(appendPromotionsSchemaHint(formatPostgrestError("Erro ao gravar cache de promoções", insErr)));
      }
    }
  }

  if (itemIds.length > 0) {
    const promoTextByItem = buildMlActivePromotionsMapFromFlatPromoRows(flat);
    for (const id of itemIds) {
      const key = String(id).trim().toUpperCase();
      if (!promoTextByItem.has(key)) promoTextByItem.set(key, "");
    }
    try {
      await patchPricingCacheMlActivePromotions(adminSupabase, accountId, promoTextByItem);
    } catch (e) {
      console.warn("[promotions-cache] sync pricing_cache.ml_active_promotions", e);
    }
  }
}

async function listPromoCacheSlicesForItems(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  itemIds: string[]
): Promise<PromoCacheSliceKey[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await supabase
    .from("promotions_cache_rows")
    .select("cache_search, cache_link_filter, cache_page")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .in("item_id", itemIds);
  if (error) {
    console.warn("[promotions-cache] list slices for items", error);
    return [{ cache_search: "", cache_link_filter: "all", cache_page: 1 }];
  }
  const seen = new Map<string, PromoCacheSliceKey>();
  for (const row of data ?? []) {
    const r = row as {
      cache_search?: string;
      cache_link_filter?: string;
      cache_page?: number;
    };
    const linkRaw = String(r.cache_link_filter ?? "all");
    const linkKey: PromotionsLinkFilter =
      linkRaw === "linked" || linkRaw === "unlinked" ? linkRaw : "all";
    const slice: PromoCacheSliceKey = {
      cache_search: String(r.cache_search ?? ""),
      cache_link_filter: linkKey,
      cache_page: Math.max(1, Number(r.cache_page) || 1),
    };
    seen.set(sliceKeyString(slice), slice);
  }
  if (seen.size === 0) {
    return [{ cache_search: "", cache_link_filter: "all", cache_page: 1 }];
  }
  return Array.from(seen.values());
}

/**
 * Atualiza no ML e persiste cache de promoções só para os anúncios informados.
 * Usado por webhooks e após participar em promoção (sem recarregar o catálogo inteiro).
 */
export async function refreshPromotionsForItems(params: {
  supabase: SupabaseClient;
  accountId: string;
  userId: string;
  itemIds: string[];
}): Promise<{ refreshed: string[]; skipped: string[] }> {
  const ids = Array.from(
    new Set(
      params.itemIds
        .map((id) => String(id).trim().toUpperCase())
        .filter((id) => /^ML[A-Z]?\d+$/i.test(id))
    )
  );
  if (ids.length === 0) return { refreshed: [], skipped: [] };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn("[promotions-cache] refreshPromotionsForItems: Supabase incompleto");
    return { refreshed: [], skipped: ids };
  }
  const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);

  const { data: accountRow, error: accErr } = await params.supabase
    .from("ml_accounts")
    .select("id, site_id, ml_user_id")
    .eq("id", params.accountId)
    .eq("user_id", params.userId)
    .single();

  if (accErr || !accountRow) {
    console.warn("[promotions-cache] refreshPromotionsForItems: conta não encontrada", accErr);
    return { refreshed: [], skipped: ids };
  }

  const mlUserId = Number(accountRow.ml_user_id);
  const siteId = (accountRow.site_id as string | null) || "MLB";

  const { data: tokenRow, error: tokenErr } = await params.supabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", params.accountId)
    .single();

  if (tokenErr || !tokenRow) {
    console.warn("[promotions-cache] refreshPromotionsForItems: token ausente", tokenErr);
    return { refreshed: [], skipped: ids };
  }

  const tr = tokenRow as { access_token: string; refresh_token: string; expires_at: string };
  const accessToken = await getValidAccessToken(
    params.accountId,
    tr.access_token,
    tr.refresh_token,
    tr.expires_at,
    adminSupabase
  );
  if (!accessToken) {
    console.warn("[promotions-cache] refreshPromotionsForItems: access token inválido");
    return { refreshed: [], skipped: ids };
  }

  const { data: mlItems, error: itemsErr } = await params.supabase
    .from("ml_items")
    .select(
      "item_id, title, status, price, thumbnail, permalink, updated_at, listing_type_id, category_id, product_id"
    )
    .eq("account_id", params.accountId)
    .in("item_id", ids);

  if (itemsErr) {
    console.error("[promotions-cache] refreshPromotionsForItems ml_items", itemsErr);
    return { refreshed: [], skipped: ids };
  }

  const mlRows = (mlItems ?? []) as MlItemRow[];
  const mlById = new Map(mlRows.map((r) => [String(r.item_id).toUpperCase(), r]));
  const skipped = ids.filter((id) => !mlById.has(id));
  const toProcess = ids.filter((id) => mlById.has(id));
  if (toProcess.length === 0) return { refreshed: [], skipped: ids };

  const isMercadoLider = await fetchIsMercadoLider(accessToken, mlUserId);
  const snapshotAt = new Date().toISOString();
  const slices = await listPromoCacheSlicesForItems(
    params.supabase,
    params.accountId,
    params.userId,
    toProcess
  );

  const mlRowsToEnrich = toProcess.map((id) => mlById.get(id)!);
  const { apiRows: allApiRows, flat: allFlat } = await enrichMlItemRowsToApiRows({
    supabase: params.supabase,
    adminSupabase,
    accountId: params.accountId,
    siteId,
    accessToken,
    isMercadoLider,
    mlUserId,
    rows: mlRowsToEnrich,
  });

  const refreshed = new Set<string>();

  for (const slice of slices) {
    const norm = slice.cache_search;
    const linkKey = slice.cache_link_filter;

    const idsToClear = toProcess.filter((id) => {
      const row = mlById.get(id);
      return row != null && !itemMatchesPromotionsLinkFilter(row, linkKey);
    });

    if (idsToClear.length > 0) {
      await params.supabase
        .from("promotions_cache_rows")
        .delete()
        .eq("account_id", params.accountId)
        .eq("user_id", params.userId)
        .eq("cache_search", norm)
        .eq("cache_link_filter", linkKey)
        .in("item_id", idsToClear);
    }

    const rowsForSlice = mlRowsToEnrich.filter((r) => itemMatchesPromotionsLinkFilter(r, linkKey));
    if (rowsForSlice.length === 0) continue;

    const sliceItemIds = new Set(rowsForSlice.map((r) => String(r.item_id).toUpperCase()));
    const apiRows = allApiRows.filter((r) => sliceItemIds.has(String(r.item_id).toUpperCase()));
    const flat = allFlat.filter((f) => sliceItemIds.has(String(f.item_id).toUpperCase()));
    const itemIds = rowsForSlice.map((r) => r.item_id);

    await persistPromoApiRowsToCacheSlice({
      supabase: params.supabase,
      adminSupabase,
      accountId: params.accountId,
      userId: params.userId,
      norm,
      linkKey,
      cachePage: slice.cache_page,
      snapshotAt,
      isMercadoLider,
      itemIds,
      apiRows,
      flat,
    });

    for (const id of itemIds) refreshed.add(String(id).toUpperCase());
  }

  return { refreshed: Array.from(refreshed), skipped };
}

/**
 * Uma página de `ml_items` → ML + taxas → grava `promotions_cache_rows` para `cache_page`.
 * @param deleteItemIdsBeforeInsert — se true, remove linhas antigas desses `item_id` (sync parcial); se false, assume wipe prévio (catálogo completo).
 */
async function writePromotionsCacheForMlItemPage(ctx: {
  supabase: SupabaseClient;
  adminSupabase: SupabaseClient;
  accountId: string;
  userId: string;
  norm: string;
  linkKey: PromotionsLinkFilter;
  cachePage: number;
  siteId: string;
  accessToken: string;
  mlUserId: number;
  isMercadoLider: boolean;
  snapshotAt: string;
  deleteItemIdsBeforeInsert: boolean;
  promotionMapByItemId?: Map<string, ItemPromotionsFromCampaigns>;
}): Promise<{ apiRows: PromoOverviewFlatApiRow[]; total: number; itemIds: string[] }> {
  const {
    supabase,
    adminSupabase,
    accountId,
    userId,
    norm,
    linkKey,
    cachePage,
    siteId,
    accessToken,
    mlUserId,
    isMercadoLider,
    snapshotAt,
    deleteItemIdsBeforeInsert,
    promotionMapByItemId,
  } = ctx;

  const from = (cachePage - 1) * PROMOTIONS_OVERVIEW_PAGE_SIZE;
  const to = from + PROMOTIONS_OVERVIEW_PAGE_SIZE - 1;

  let query = supabase
    .from("ml_items")
    .select(
      "item_id, title, status, price, thumbnail, permalink, updated_at, listing_type_id, category_id",
      { count: "exact" }
    )
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (linkKey === "linked") query = query.not("product_id", "is", null);
  else if (linkKey === "unlinked") query = query.is("product_id", null);

  if (norm) {
    query = query.or(`title.ilike.%${norm}%,item_id.ilike.%${norm}%`);
  }

  const { data: items, error: itemsErr, count } = await query;
  if (itemsErr) {
    console.error("[promotions-cache] refresh items", itemsErr);
    throw new Error(appendPromotionsSchemaHint(formatPostgrestError("Erro ao listar anúncios", itemsErr)));
  }

  const rows = (items ?? []) as MlItemRow[];
  const total = count ?? 0;

  const { apiRows, flat, itemIds } = await enrichMlItemRowsToApiRows({
    supabase,
    adminSupabase,
    accountId,
    siteId,
    accessToken,
    isMercadoLider,
    mlUserId,
    rows,
    promotionMapByItemId,
  });

  if (deleteItemIdsBeforeInsert) {
    await persistPromoApiRowsToCacheSlice({
      supabase,
      adminSupabase,
      accountId,
      userId,
      norm,
      linkKey,
      cachePage,
      snapshotAt,
      isMercadoLider,
      itemIds,
      apiRows,
      flat,
    });
  } else if (apiRows.length > 0) {
    const dbRows = apiRows.map((r) => ({
      account_id: accountId,
      user_id: userId,
      cache_page: cachePage,
      cache_search: norm,
      cache_link_filter: linkKey,
      row_key: r.rowKey,
      item_id: r.item_id,
      title: r.title,
      status: r.status,
      thumbnail: r.thumbnail,
      permalink: r.permalink,
      updated_at: r.updated_at || null,
      listing_type_id: r.listing_type_id,
      category_id: r.category_id,
      list_price: r.list_price,
      active_price: r.active_price,
      promotion_kind: r.promotionKind,
      promotion_label: r.promotionLabel,
      promotion_type: r.promotionType ?? null,
      campaign_start_at: r.campaign_start_at ?? null,
      campaign_finish_at: r.campaign_finish_at ?? null,
      ml_promotion_id: r.ml_promotion_id ?? null,
      promo_price: r.promo_price,
      value_hint: r.value_hint,
      promotions_api_failed: r.promotions_api_failed,
      cost_price: r.cost_price,
      weight_kg: r.weight_kg,
      height_cm: r.height_cm,
      width_cm: r.width_cm,
      length_cm: r.length_cm,
      tax_percent: r.tax_percent,
      extra_fee_percent: r.extra_fee_percent,
      fixed_expenses: r.fixed_expenses,
      fee: r.pricing?.fee ?? null,
      meli_fee_subsidy: r.pricing?.meli_fee_subsidy ?? null,
      shipping_cost: r.pricing?.shipping_cost ?? null,
      tax_amount: r.pricing?.tax_amount ?? null,
      extra_fee_amount: r.pricing?.extra_fee_amount ?? null,
      fixed_expenses_amount: r.pricing?.fixed_expenses_amount ?? null,
      net_amount: r.pricing?.net_amount ?? null,
      profit: r.profit,
      profit_percent: r.profit_percent,
      snapshot_at: snapshotAt,
      is_mercado_lider_snapshot: isMercadoLider,
    }));
    const chunkSize = 80;
    for (let i = 0; i < dbRows.length; i += chunkSize) {
      const slice = dbRows.slice(i, i + chunkSize);
      const { error: insErr } = await supabase.from("promotions_cache_rows").insert(slice);
      if (insErr) {
        console.error("[promotions-cache] insert", insErr);
        throw new Error(appendPromotionsSchemaHint(formatPostgrestError("Erro ao gravar cache de promoções", insErr)));
      }
    }
  }

  return { apiRows, total, itemIds };
}

/**
 * Busca ML + recalcula taxas, persiste em promotions_cache_rows e devolve as linhas achatadas.
 * `refreshScope: "all"` — todas as páginas de anúncios (mesmos `search` + vínculo); `"page"` — só a página `page`.
 */
export async function refreshPromotionsCache(params: {
  supabase: SupabaseClient;
  accountId: string;
  userId: string;
  page: number;
  search: string;
  linkFilter?: PromotionsLinkFilter;
  refreshScope?: "page" | "all";
  /** Chamado após cada página processada no scope `all` (processed, totalPages). */
  onProgress?: (processed: number, totalPages: number) => void | Promise<void>;
}): Promise<{ rows: PromoOverviewFlatApiRow[]; total: number; snapshot_at: string }> {
  const { supabase, accountId, userId } = params;
  const norm = normalizeCacheSearch(params.search);
  const linkKey: PromotionsLinkFilter = params.linkFilter ?? "all";
  const cachePage = Math.max(1, params.page);
  const refreshScope = params.refreshScope ?? "page";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Configuração do servidor incompleta");
  }
  const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);

  const { data: accountRow, error: accErr } = await supabase
    .from("ml_accounts")
    .select("id, site_id, ml_user_id")
    .eq("id", accountId)
    .eq("user_id", userId)
    .single();

  if (accErr || !accountRow) {
    throw new Error("Conta não encontrada");
  }

  const mlUserId = Number(accountRow.ml_user_id);
  const siteId = (accountRow.site_id as string | null) || "MLB";

  const { data: tokenRow, error: tokenErr } = await supabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", accountId)
    .single();

  if (tokenErr || !tokenRow) {
    throw new Error("Token Mercado Livre não encontrado");
  }

  const tr = tokenRow as { access_token: string; refresh_token: string; expires_at: string };
  const accessToken = await getValidAccessToken(
    accountId,
    tr.access_token,
    tr.refresh_token,
    tr.expires_at,
    supabase
  );

  if (!accessToken) {
    throw new Error("Não foi possível obter access token válido");
  }

  const isMercadoLider = await fetchIsMercadoLider(accessToken, mlUserId);

  const totalCount = await countMlItemsForPromotionsPage(supabase, accountId, norm, linkKey);

  if (refreshScope === "all") {
    /** Sem wipe global antes do loop: evita cache vazio + data “nova” se o refresh falhar no meio. Limpeza ao final em `pruneStalePromotionsCacheRows`. */
    const snapshotAt = new Date().toISOString();
    const pages = totalCount <= 0 ? 0 : Math.ceil(totalCount / PROMOTIONS_OVERVIEW_PAGE_SIZE);

    /** Sync rápido: campanhas → itens (como aba Campanhas), depois lucro/produto por página do catálogo. */
    const promotionMapByItemId = await collectPromotionsByItemFromAllCampaigns(mlUserId, accessToken, {
      onCampaignProgress: async (processedCampaigns, totalCampaigns) => {
        if (!params.onProgress || pages <= 0) return;
        const phaseShare = Math.max(1, Math.ceil(pages * 0.15));
        const mapped = Math.min(
          phaseShare,
          Math.ceil((processedCampaigns / Math.max(totalCampaigns, 1)) * phaseShare)
        );
        await params.onProgress(mapped, pages);
      },
    });

    const keptItemIds = new Set<string>();
    for (let p = 1; p <= pages; p++) {
      const { itemIds } = await writePromotionsCacheForMlItemPage({
        supabase,
        adminSupabase,
        accountId,
        userId,
        norm,
        linkKey,
        cachePage: p,
        siteId,
        accessToken,
        mlUserId,
        isMercadoLider,
        snapshotAt,
        deleteItemIdsBeforeInsert: true,
        promotionMapByItemId,
      });
      for (const id of itemIds) keptItemIds.add(id);
      if (params.onProgress) await params.onProgress(p, pages);
    }

    await pruneStalePromotionsCacheRows(supabase, accountId, userId, norm, linkKey, keptItemIds);

    const readBack = await readPromotionsCache(supabase, accountId, userId, cachePage, norm, linkKey);
    return {
      rows: readBack.rows,
      total: readBack.total,
      snapshot_at: readBack.snapshot_at ?? snapshotAt,
    };
  }

  const snapshotAt = new Date().toISOString();
  const { apiRows, total } = await writePromotionsCacheForMlItemPage({
    supabase,
    adminSupabase,
    accountId,
    userId,
    norm,
    linkKey,
    cachePage,
    siteId,
    accessToken,
    mlUserId,
    isMercadoLider,
    snapshotAt,
    deleteItemIdsBeforeInsert: true,
  });

  return { rows: apiRows, total, snapshot_at: snapshotAt };
}
