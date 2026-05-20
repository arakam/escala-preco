import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { fetchMlResourcePath } from "@/lib/mercadolivre/client";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import {
  filterCampaignsByUiCategory,
  getMlPromotionUiCategory,
  parseMlPromotionUiCategoryId,
  type MlPromotionUiCategoryId,
} from "@/lib/mercadolivre/ml-promotion-ui-categories";
import { normalizeMlPromotionTypeCode } from "@/lib/mercadolivre/ml-promotion-types";
import {
  partitionSellerPromotionRowByStatus,
  sellerPromotionDisplayRowFromBankCampaignItem,
  sellerPromotionDisplayRowFromCampaignItem,
  type SellerPromotionDisplayRow,
} from "@/lib/mercadolivre/seller-promotions-item";

export type MlSellerCampaignRow = {
  id: string;
  type: string;
  status: string;
  name: string;
  start_date: string | null;
  finish_date: string | null;
  deadline_date: string | null;
  benefits: Record<string, unknown> | null;
};

export type MlCampaignItemRow = {
  item_id: string;
  status: string;
  price: number | null;
  original_price: number | null;
  meli_percentage: number | null;
  seller_percentage: number | null;
  offer_id: string | null;
};

export type MlCampaignItemsPage = {
  results: MlCampaignItemRow[];
  paging: {
    total: number | null;
    limit: number | null;
    search_after: string | null;
  };
};

function parseMlStatus(raw: unknown): string {
  if (raw == null || raw === "") return "";
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const id = (raw as Record<string, unknown>).id;
    if (id != null) return String(id).toLowerCase();
  }
  return String(raw).toLowerCase();
}

function parseBenefits(raw: unknown): Record<string, unknown> | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function normalizeCampaignRow(raw: Record<string, unknown>): MlSellerCampaignRow | null {
  const id = String(raw.id ?? "").trim();
  if (!id) return null;
  const type = normalizeMlPromotionTypeCode(String(raw.type ?? "")) || String(raw.type ?? "").trim();
  return {
    id,
    type,
    status: parseMlStatus(raw.status),
    name: String(raw.name ?? "").trim() || id,
    start_date: raw.start_date != null ? String(raw.start_date) : null,
    finish_date: raw.finish_date != null ? String(raw.finish_date) : null,
    deadline_date: raw.deadline_date != null ? String(raw.deadline_date) : null,
    benefits: parseBenefits(raw.benefits),
  };
}

function normalizeCampaignItemRow(raw: Record<string, unknown>): MlCampaignItemRow | null {
  const item_id = String(raw.id ?? raw.item_id ?? "").trim().toUpperCase();
  if (!item_id) return null;
  const price = Number(raw.price);
  const original_price = Number(raw.original_price);
  const meli_percentage = Number(raw.meli_percentage);
  const seller_percentage = Number(raw.seller_percentage);
  const offerRaw = raw.offer_id ?? raw.offerId;
  return {
    item_id,
    status: parseMlStatus(raw.status),
    price: Number.isFinite(price) && price > 0 ? price : null,
    original_price: Number.isFinite(original_price) && original_price > 0 ? original_price : null,
    meli_percentage: Number.isFinite(meli_percentage) ? meli_percentage : null,
    seller_percentage: Number.isFinite(seller_percentage) ? seller_percentage : null,
    offer_id: offerRaw != null && String(offerRaw).trim() !== "" ? String(offerRaw).trim() : null,
  };
}

export async function resolveMlAccountAccessToken(
  supabase: SupabaseClient,
  accountId: string,
  userId: string
): Promise<{ accessToken: string; mlUserId: number; siteId: string } | null> {
  const { data: accountRow, error: accErr } = await supabase
    .from("ml_accounts")
    .select("id, site_id, ml_user_id")
    .eq("id", accountId)
    .eq("user_id", userId)
    .single();

  if (accErr || !accountRow) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) return null;

  const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);
  const { data: tokenRow, error: tokenErr } = await adminSupabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", accountId)
    .single();

  if (tokenErr || !tokenRow) return null;

  const tr = tokenRow as { access_token: string; refresh_token: string; expires_at: string };
  const accessToken = await getValidAccessToken(
    accountId,
    tr.access_token,
    tr.refresh_token,
    tr.expires_at,
    adminSupabase
  );
  if (!accessToken) return null;

  return {
    accessToken,
    mlUserId: Number(accountRow.ml_user_id),
    siteId: (accountRow.site_id as string | null) || "MLB",
  };
}

/** GET /seller-promotions/users/{user_id} */
export async function fetchSellerPromotionsForUser(
  mlUserId: number,
  accessToken: string,
  options?: { offset?: number; limit?: number }
): Promise<
  | { ok: true; campaigns: MlSellerCampaignRow[]; paging: { offset: number; limit: number; total: number } }
  | { ok: false; status: number; message: string }
> {
  const offset = Math.max(0, options?.offset ?? 0);
  const limit = Math.min(50, Math.max(1, options?.limit ?? 50));
  const path = `/seller-promotions/users/${mlUserId}?offset=${offset}&limit=${limit}`;
  const res = await fetchMlResourcePath(path, accessToken);
  if (!res.ok) {
    return { ok: false, status: res.status, message: res.body.slice(0, 300) };
  }

  const data = res.data as Record<string, unknown> | null;
  const rawResults = Array.isArray(data?.results) ? data!.results : [];
  const campaigns: MlSellerCampaignRow[] = [];
  for (const row of rawResults) {
    if (row == null || typeof row !== "object") continue;
    const c = normalizeCampaignRow(row as Record<string, unknown>);
    if (c) campaigns.push(c);
  }

  const pagingRaw = (data?.paging ?? {}) as Record<string, unknown>;
  const paging = {
    offset: Number(pagingRaw.offset) || offset,
    limit: Number(pagingRaw.limit) || limit,
    total: Number(pagingRaw.total) || campaigns.length,
  };

  return { ok: true, campaigns, paging };
}

const MAX_ML_CAMPAIGN_SCAN_PAGES = 40;

function isBankPixCampaignType(type: string): boolean {
  const t = normalizeMlPromotionTypeCode(type) || type.trim().toUpperCase();
  return t === "BANK" || t.startsWith("BANK");
}

/** Campanhas BANK (Desconto no PIX) do vendedor — GET /seller-promotions/users/{id}. */
export async function listBankPixCampaignsForUser(
  mlUserId: number,
  accessToken: string
): Promise<MlSellerCampaignRow[]> {
  const out: MlSellerCampaignRow[] = [];
  let offset = 0;
  const limit = 50;

  for (let page = 0; page < MAX_ML_CAMPAIGN_SCAN_PAGES; page++) {
    const batch = await fetchSellerPromotionsForUser(mlUserId, accessToken, { offset, limit });
    if (!batch.ok) break;
    for (const c of batch.campaigns) {
      if (isBankPixCampaignType(c.type)) out.push(c);
    }
    if (batch.campaigns.length < limit || offset + limit >= batch.paging.total) break;
    offset += limit;
  }

  return out;
}

/**
 * Varre páginas do ML e devolve campanhas filtradas por aba (categoria UI).
 * Necessário porque a API não filtra por categoria nem por `type` em /users/{id}.
 */
export async function fetchSellerPromotionsForUserByUiCategory(
  mlUserId: number,
  accessToken: string,
  options: {
    categoryId: MlPromotionUiCategoryId;
    offset?: number;
    limit?: number;
  }
): Promise<
  | {
      ok: true;
      campaigns: MlSellerCampaignRow[];
      paging: { offset: number; limit: number; total: number; scanned_ml_total: number };
    }
  | { ok: false; status: number; message: string }
> {
  const category = getMlPromotionUiCategory(options.categoryId);
  if (!category) {
    return { ok: false, status: 400, message: "Categoria de promoção inválida." };
  }

  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(50, Math.max(1, options.limit ?? 50));
  const pageSize = 50;
  const allFiltered: MlSellerCampaignRow[] = [];
  let mlOffset = 0;
  let scannedMlTotal = 0;

  for (let page = 0; page < MAX_ML_CAMPAIGN_SCAN_PAGES; page++) {
    const batch = await fetchSellerPromotionsForUser(mlUserId, accessToken, {
      offset: mlOffset,
      limit: pageSize,
    });
    if (!batch.ok) {
      return { ok: false, status: batch.status, message: batch.message };
    }
    scannedMlTotal = batch.paging.total;
    const filtered = filterCampaignsByUiCategory(batch.campaigns, category);
    allFiltered.push(...filtered);

    const received = batch.campaigns.length;
    if (received < pageSize) break;
    mlOffset += pageSize;
    if (mlOffset >= batch.paging.total) break;
  }

  const slice = allFiltered.slice(offset, offset + limit);
  return {
    ok: true,
    campaigns: slice,
    paging: {
      offset,
      limit,
      total: allFiltered.length,
      scanned_ml_total: scannedMlTotal,
    },
  };
}

export type FetchCampaignItemsParams = {
  promotionId: string;
  promotionType: string;
  accessToken: string;
  status?: "" | "candidate" | "started" | "pending";
  itemId?: string;
  limit?: number;
  searchAfter?: string | null;
};

/** GET /seller-promotions/promotions/{id}/items */
export async function fetchSellerPromotionCampaignItems(
  params: FetchCampaignItemsParams
): Promise<
  | { ok: true; page: MlCampaignItemsPage }
  | { ok: false; status: number; message: string }
> {
  const pid = encodeURIComponent(params.promotionId.trim());
  const ptype = encodeURIComponent(
    normalizeMlPromotionTypeCode(params.promotionType) || params.promotionType.trim()
  );
  const q = new URLSearchParams();
  q.set("promotion_type", ptype);
  const limit = Math.min(50, Math.max(1, params.limit ?? 50));
  q.set("limit", String(limit));
  if (params.status) q.set("status", params.status);
  if (params.itemId?.trim()) q.set("item_id", params.itemId.trim().toUpperCase());
  if (params.searchAfter?.trim()) q.set("search_after", params.searchAfter.trim());

  const path = `/seller-promotions/promotions/${pid}/items?${q.toString()}`;
  const res = await fetchMlResourcePath(path, params.accessToken);
  if (!res.ok) {
    return { ok: false, status: res.status, message: res.body.slice(0, 300) };
  }

  const data = res.data as Record<string, unknown> | null;
  const rawResults = Array.isArray(data?.results) ? data!.results : [];
  const results: MlCampaignItemRow[] = [];
  for (const row of rawResults) {
    if (row == null || typeof row !== "object") continue;
    const item = normalizeCampaignItemRow(row as Record<string, unknown>);
    if (item) results.push(item);
  }

  const pagingRaw = (data?.paging ?? {}) as Record<string, unknown>;
  const searchAfter =
    (pagingRaw.search_after != null ? String(pagingRaw.search_after) : null) ||
    (pagingRaw.searchAfter != null ? String(pagingRaw.searchAfter) : null);

  return {
    ok: true,
    page: {
      results,
      paging: {
        total: pagingRaw.total != null ? Number(pagingRaw.total) : null,
        limit: pagingRaw.limit != null ? Number(pagingRaw.limit) : limit,
        search_after: searchAfter?.trim() ? searchAfter.trim() : null,
      },
    },
  };
}

/** Consulta campanhas BANK/PIX se o item participa (GET …/promotions/{id}/items?item_id=). */
export async function fetchBankPixPromotionRowsForItem(
  itemId: string,
  accessToken: string,
  bankCampaigns: MlSellerCampaignRow[]
): Promise<{ active: SellerPromotionDisplayRow[]; possible: SellerPromotionDisplayRow[] }> {
  const active: SellerPromotionDisplayRow[] = [];
  const possible: SellerPromotionDisplayRow[] = [];
  const id = String(itemId).trim().toUpperCase();
  if (!id || bankCampaigns.length === 0) return { active, possible };

  for (const campaign of bankCampaigns) {
    const res = await fetchSellerPromotionCampaignItems({
      promotionId: campaign.id,
      promotionType: "BANK",
      accessToken,
      itemId: id,
      limit: 5,
    });
    if (!res.ok) continue;
    for (const item of res.page.results) {
      const row = sellerPromotionDisplayRowFromBankCampaignItem(campaign, item);
      const bucket = partitionSellerPromotionRowByStatus(row, item.status);
      if (bucket === "active") active.push(row);
      else possible.push(row);
    }
  }

  return { active, possible };
}

export type ItemPromotionsFromCampaigns = {
  active: SellerPromotionDisplayRow[];
  possible: SellerPromotionDisplayRow[];
};

const MAX_CAMPAIGN_ITEM_PAGES = 200;

function mergeItemPromotionBucket(
  map: Map<string, ItemPromotionsFromCampaigns>,
  itemId: string,
  row: SellerPromotionDisplayRow,
  bucket: "active" | "possible"
): void {
  const key = itemId.trim().toUpperCase();
  if (!key) return;
  let entry = map.get(key);
  if (!entry) {
    entry = { active: [], possible: [] };
    map.set(key, entry);
  }
  const list = bucket === "active" ? entry.active : entry.possible;
  const dedupeKey = `${row.ml_promotion_id ?? ""}|${row.promotion_type ?? ""}|${row.label}`;
  if (list.some((r) => `${r.ml_promotion_id ?? ""}|${r.promotion_type ?? ""}|${r.label}` === dedupeKey)) {
    return;
  }
  list.push(row);
}

/**
 * Varre campanhas do vendedor e itens de cada campanha (API agregada, como a aba Campanhas).
 * Retorna promoções por MLB — muito menos chamadas que GET /seller-promotions/items/{id} por anúncio.
 */
export async function collectPromotionsByItemFromAllCampaigns(
  mlUserId: number,
  accessToken: string,
  options?: {
    onCampaignProgress?: (processed: number, totalCampaigns: number) => void | Promise<void>;
  }
): Promise<Map<string, ItemPromotionsFromCampaigns>> {
  const map = new Map<string, ItemPromotionsFromCampaigns>();
  const campaigns: MlSellerCampaignRow[] = [];
  let offset = 0;
  const pageSize = 50;

  for (let page = 0; page < MAX_ML_CAMPAIGN_SCAN_PAGES; page++) {
    const batch = await fetchSellerPromotionsForUser(mlUserId, accessToken, {
      offset,
      limit: pageSize,
    });
    if (!batch.ok) {
      throw new Error(batch.message || `Erro ao listar campanhas (${batch.status})`);
    }
    campaigns.push(...batch.campaigns);
    if (batch.campaigns.length < pageSize || offset + pageSize >= batch.paging.total) break;
    offset += pageSize;
  }

  const totalCampaigns = campaigns.length;
  let processed = 0;

  for (const campaign of campaigns) {
    processed += 1;
    if (options?.onCampaignProgress) {
      await options.onCampaignProgress(processed, totalCampaigns);
    }

    let searchAfter: string | null = null;
    for (let itemPage = 0; itemPage < MAX_CAMPAIGN_ITEM_PAGES; itemPage++) {
      const res = await fetchSellerPromotionCampaignItems({
        promotionId: campaign.id,
        promotionType: campaign.type,
        accessToken,
        limit: 50,
        searchAfter,
      });
      if (!res.ok) {
        console.warn(
          "[collectPromotionsByItemFromAllCampaigns] items",
          campaign.id,
          res.status,
          res.message
        );
        break;
      }

      for (const item of res.page.results) {
        const displayRow = isBankPixCampaignType(campaign.type)
          ? sellerPromotionDisplayRowFromBankCampaignItem(campaign, item)
          : sellerPromotionDisplayRowFromCampaignItem(campaign, item);
        const bucket = partitionSellerPromotionRowByStatus(displayRow, item.status);
        mergeItemPromotionBucket(map, item.item_id, displayRow, bucket);
      }

      const next = res.page.paging.search_after;
      if (!next) break;
      searchAfter = next;
    }
  }

  return map;
}

export function formatCampaignBenefitsHint(benefits: Record<string, unknown> | null): string | null {
  if (!benefits) return null;
  const parts: string[] = [];
  const meli = benefits.meli_percent ?? benefits.meli_percentage;
  const seller = benefits.seller_percent ?? benefits.seller_percentage;
  if (meli != null && Number.isFinite(Number(meli))) parts.push(`ML ${meli}%`);
  if (seller != null && Number.isFinite(Number(seller))) parts.push(`vend. ${seller}%`);
  const name = benefits.name != null ? String(benefits.name).trim() : "";
  if (name) parts.push(name);
  return parts.length > 0 ? parts.join(" · ") : null;
}
