import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { fetchMlResourcePath } from "@/lib/mercadolivre/client";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { normalizeMlPromotionTypeCode } from "@/lib/mercadolivre/ml-promotion-types";

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
  return {
    item_id,
    status: parseMlStatus(raw.status),
    price: Number.isFinite(price) ? price : null,
    original_price: Number.isFinite(original_price) ? original_price : null,
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
