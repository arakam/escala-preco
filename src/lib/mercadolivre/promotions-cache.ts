import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  fetchSellerPromotionsForItem,
  getItemPrices,
  getStandardPriceAmount,
  runWithConcurrency,
} from "@/lib/mercadolivre/client";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import {
  partitionSellerPromotionsRich,
  type SellerPromotionDisplayRow,
} from "@/lib/mercadolivre/seller-promotions-item";
import { computeItemsFees, type PricingFeeInputItem } from "@/lib/pricing/compute-items-fees";
import { calculateFullPricing } from "@/lib/pricing/full-net";
import { PRICING_CALCULATE_CLIENT_BATCH_SIZE } from "@/lib/pricing/calculate-limits";
import {
  inferPromotionTypeFromAnyLabelText,
  normalizeMlPromotionTypeCode,
} from "@/lib/mercadolivre/ml-promotion-types";

export const PROMOTIONS_OVERVIEW_PAGE_SIZE = 12;
const ML_ENRICH_CONCURRENCY = 3;

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
};

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
  return { promotionKind, profit, promotionType, campaignPhase };
}

function hasPromotionsOverviewExtraFilters(f?: PromotionsOverviewExtraFilters): boolean {
  return !!(f?.promotionKind || f?.profit || f?.promotionType || f?.campaignPhase);
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
};

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
    vai_receber: number;
    net_amount: number;
  } | null;
  profit: number | null;
  profit_percent: number | null;
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
          vai_receber: pricing.vai_receber,
          net_amount: pricing.net_amount,
        }
      : null,
    profit,
    profit_percent: profitPercent,
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
  cachePage: number
): Promise<string[]> {
  const from = (cachePage - 1) * PROMOTIONS_OVERVIEW_PAGE_SIZE;
  const to = from + PROMOTIONS_OVERVIEW_PAGE_SIZE - 1;
  let q = supabase.from("ml_items").select("item_id").eq("account_id", accountId);
  if (linkKey === "linked") q = q.not("product_id", "is", null);
  else if (linkKey === "unlinked") q = q.is("product_id", null);
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

  const pricing = hasPricing
    ? {
        price: Number(row.promo_price ?? row.active_price ?? 0),
        fee: row.fee != null ? Number(row.fee) : 0,
        shipping_cost: row.shipping_cost != null ? Number(row.shipping_cost) : 0,
        tax_amount: Number(row.tax_amount ?? 0),
        extra_fee_amount: Number(row.extra_fee_amount ?? 0),
        fixed_expenses_amount: Number(row.fixed_expenses_amount ?? 0),
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
  };
}

export async function countMlItemsForPromotionsPage(
  supabase: SupabaseClient,
  accountId: string,
  search: string,
  linkFilter: PromotionsLinkFilter = "all"
): Promise<number> {
  const norm = normalizeCacheSearch(search);
  let q = supabase
    .from("ml_items")
    .select("item_id", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (linkFilter === "linked") q = q.not("product_id", "is", null);
  else if (linkFilter === "unlinked") q = q.is("product_id", null);
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

    const pageItemIds = await fetchMlItemIdsPage(supabase, accountId, norm, linkKey, cachePage);

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
    const totalFiltered = deduped.length;
    const pageSize = PROMOTIONS_OVERVIEW_PAGE_SIZE;
    const fromIdx = (cachePage - 1) * pageSize;
    const pageSlice = deduped.slice(fromIdx, fromIdx + pageSize);

    let snapshotAt: string | null =
      pageSlice[0]?.snapshot_at != null ? String(pageSlice[0].snapshot_at) : null;
    for (const row of pageSlice) {
      if (row.snapshot_at == null) continue;
      const s = String(row.snapshot_at);
      if (!snapshotAt || s > snapshotAt) snapshotAt = s;
    }

    const rows: PromoOverviewFlatApiRow[] = pageSlice.map(mapPromotionCacheDbRowToApi);
    return { rows, total: totalFiltered, snapshot_at: snapshotAt };
  }

  const total = await countMlItemsForPromotionsPage(supabase, accountId, norm, linkKey);

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
    const pageItemIds = await fetchMlItemIdsPage(supabase, accountId, norm, linkKey, cachePage);
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

  const rows: PromoOverviewFlatApiRow[] = list.map(mapPromotionCacheDbRowToApi);

  return { rows, total, snapshot_at: snapshotAt };
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
  isMercadoLider: boolean;
  snapshotAt: string;
  deleteItemIdsBeforeInsert: boolean;
}): Promise<{ apiRows: PromoOverviewFlatApiRow[]; total: number }> {
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
    isMercadoLider,
    snapshotAt,
    deleteItemIdsBeforeInsert,
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
    throw new Error("Erro ao listar anúncios");
  }

  const rows = (items ?? []) as MlItemRow[];
  const total = count ?? 0;
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

  const enriched: PromoOverviewEnrichedRow[] = await runWithConcurrency(
    rows,
    ML_ENRICH_CONCURRENCY,
    async (row) => {
      const itemId = row.item_id;
      const listPrice = row.price != null ? Number(row.price) : null;
      const cache = cacheByItem.get(itemId) ?? null;
      const [promoRaw, prices] = await Promise.all([
        fetchSellerPromotionsForItem(itemId, accessToken),
        getItemPrices(itemId, accessToken, {}),
      ]);
      const standard = getStandardPriceAmount(prices);
      const activePrice =
        standard != null && Number.isFinite(standard) && standard > 0
          ? standard
          : listPrice != null && Number.isFinite(listPrice) && listPrice > 0
            ? listPrice
            : null;

      const { active, possible } = partitionSellerPromotionsRich(promoRaw);
      const promotionsFailed = promoRaw === null;

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
        active_price: activePrice,
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
    }
  );

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
        meli_fee_subsidy: f.meli_fee_subsidy,
      },
    });
  });

  const feeByFlatIndex = new Map<number, { fee: number; shipping_cost: number; price: number }>();
  for (let i = 0; i < feeEntries.length; i += PRICING_CALCULATE_CLIENT_BATCH_SIZE) {
    const chunk = feeEntries.slice(i, i + PRICING_CALCULATE_CLIENT_BATCH_SIZE);
    const { results } = await computeItemsFees(
      chunk.map((c) => c.item),
      {
        siteId,
        accessToken,
        isMercadoLider,
        supabaseAdmin: adminSupabase,
      }
    );
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

  if (deleteItemIdsBeforeInsert && itemIds.length > 0) {
    const { error: delErr } = await supabase
      .from("promotions_cache_rows")
      .delete()
      .eq("account_id", accountId)
      .eq("user_id", userId)
      .in("item_id", itemIds);
    if (delErr) {
      console.error("[promotions-cache] delete por item_id (sync ML)", delErr);
      throw new Error("Erro ao limpar cache de promoções");
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
        throw new Error("Erro ao gravar cache de promoções");
      }
    }
  }

  return { apiRows, total };
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
    const { error: wipeErr } = await supabase
      .from("promotions_cache_rows")
      .delete()
      .eq("account_id", accountId)
      .eq("user_id", userId)
      .eq("cache_search", norm)
      .eq("cache_link_filter", linkKey);

    if (wipeErr) {
      console.error("[promotions-cache] wipe snapshot (search+link)", wipeErr);
      throw new Error("Erro ao limpar cache de promoções");
    }

    const snapshotAt = new Date().toISOString();
    const pages = totalCount <= 0 ? 0 : Math.ceil(totalCount / PROMOTIONS_OVERVIEW_PAGE_SIZE);

    for (let p = 1; p <= pages; p++) {
      await writePromotionsCacheForMlItemPage({
        supabase,
        adminSupabase,
        accountId,
        userId,
        norm,
        linkKey,
        cachePage: p,
        siteId,
        accessToken,
        isMercadoLider,
        snapshotAt,
        deleteItemIdsBeforeInsert: false,
      });
    }

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
    isMercadoLider,
    snapshotAt,
    deleteItemIdsBeforeInsert: true,
  });

  return { rows: apiRows, total, snapshot_at: snapshotAt };
}
