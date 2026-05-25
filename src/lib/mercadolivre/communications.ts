/**
 * Comunicações do Mercado Livre — GET /communications/notices
 * https://developers.mercadolivre.com.br/pt_br/conheca-as-novidades-que-os-vendedores-recebem
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWithRetry } from "./client";

export interface MLCommunicationAction {
  text: string;
  link: string;
}

export interface MLCommunicationTag {
  tag: string;
  type: string;
}

export interface MLCommunicationNotice {
  id: string;
  label: string;
  description?: string;
  highlighted?: boolean;
  from_date?: string;
  tags?: MLCommunicationTag[];
  actions?: MLCommunicationAction[];
  dismiss_key?: string;
  title?: string;
  category?: string;
  sub_category?: string;
}

interface NoticesPageResponse {
  paging: { total: number; offset: number; limit: number };
  results: MLCommunicationNotice[];
}

const PAGE_LIMIT = 50;

export async function fetchCommunicationNoticesPage(
  accessToken: string,
  offset = 0,
  limit = PAGE_LIMIT
): Promise<NoticesPageResponse> {
  const url = `https://api.mercadolibre.com/communications/notices?limit=${limit}&offset=${offset}`;
  const res = await fetchWithRetry(url, accessToken);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`communications/notices failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return (await res.json()) as NoticesPageResponse;
}

export async function fetchAllCommunicationNotices(accessToken: string): Promise<MLCommunicationNotice[]> {
  const all: MLCommunicationNotice[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const page = await fetchCommunicationNoticesPage(accessToken, offset, PAGE_LIMIT);
    const results = page.results ?? [];
    total = page.paging?.total ?? results.length;
    all.push(...results);
    if (results.length === 0) break;
    offset += results.length;
    if (results.length < PAGE_LIMIT) break;
  }

  return all;
}

function parseFromDate(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function syncCommunicationNoticesForAccount(
  supabase: SupabaseClient,
  userId: string,
  accountId: string,
  accessToken: string
): Promise<{ synced: number; removed: number }> {
  const notices = await fetchAllCommunicationNotices(accessToken);
  const now = new Date().toISOString();
  const noticeIds = notices.map((n) => String(n.id));

  for (const notice of notices) {
    const row = {
      user_id: userId,
      account_id: accountId,
      notice_id: String(notice.id),
      label: notice.label?.trim() || notice.title?.trim() || "Comunicação",
      title: notice.title?.trim() || null,
      description: notice.description ?? null,
      highlighted: Boolean(notice.highlighted),
      from_date: parseFromDate(notice.from_date),
      category: notice.category ?? null,
      sub_category: notice.sub_category ?? null,
      tags: notice.tags ?? [],
      actions: notice.actions ?? [],
      dismiss_key: notice.dismiss_key ?? null,
      synced_at: now,
      updated_at: now,
    };

    const { error } = await supabase.from("ml_communication_notices").upsert(row, {
      onConflict: "account_id,notice_id",
      ignoreDuplicates: false,
    });

    if (error) {
      throw new Error(`upsert ml_communication_notices: ${error.message}`);
    }
  }

  let removed = 0;
  if (noticeIds.length === 0) {
    const { data: deleted, error: delErr } = await supabase
      .from("ml_communication_notices")
      .delete()
      .eq("account_id", accountId)
      .select("id");
    if (delErr) throw new Error(`cleanup ml_communication_notices: ${delErr.message}`);
    removed = deleted?.length ?? 0;
  } else {
    const { data: stale, error: listErr } = await supabase
      .from("ml_communication_notices")
      .select("id, notice_id")
      .eq("account_id", accountId);
    if (listErr) throw new Error(`list stale notices: ${listErr.message}`);

    const staleIds = (stale ?? [])
      .filter((r) => !noticeIds.includes(String((r as { notice_id: string }).notice_id)))
      .map((r) => (r as { id: string }).id);

    if (staleIds.length > 0) {
      const { data: deleted, error: delErr } = await supabase
        .from("ml_communication_notices")
        .delete()
        .in("id", staleIds)
        .select("id");
      if (delErr) throw new Error(`delete stale notices: ${delErr.message}`);
      removed = deleted?.length ?? 0;
    }
  }

  return { synced: notices.length, removed };
}
