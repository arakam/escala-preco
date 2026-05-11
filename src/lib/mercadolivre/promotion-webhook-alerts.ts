import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMlResourcePath } from "@/lib/mercadolivre/client";
import { getLatestValidAccessToken } from "@/lib/mercadolivre/refresh";

function extractExternalId(resourcePath: string): string | null {
  const m = resourcePath.match(/\/(?:candidates|offers)\/([^/?]+)/i);
  return m?.[1] ? decodeURIComponent(m[1].trim()) : null;
}

function parseCandidateOfferBody(raw: unknown): {
  item_id: string | null;
  promotion_id: string | null;
  promotion_type: string | null;
  status_label: string | null;
} {
  if (!raw || typeof raw !== "object") {
    return { item_id: null, promotion_id: null, promotion_type: null, status_label: null };
  }
  const o = raw as Record<string, unknown>;
  const item_id = o.item_id != null ? String(o.item_id).trim() : null;
  const promotion_id = o.promotion_id != null ? String(o.promotion_id).trim() : null;
  const promotion_type = o.type != null ? String(o.type).trim() : null;
  let status_label: string | null = null;
  const st = o.status;
  if (st != null && typeof st === "object" && !Array.isArray(st)) {
    const id = (st as Record<string, unknown>).id;
    if (id != null) status_label = String(id);
  } else if (typeof st === "string") {
    status_label = st;
  }
  return { item_id, promotion_id, promotion_type, status_label };
}

/**
 * Resolve o recurso da notificação (GET) e grava aviso para a tela Promoções.
 * Chamado a partir do webhook com service client + token da conta.
 */
export async function resolveAndStorePromotionWebhookAlert(
  supabase: SupabaseClient,
  account: { id: string; user_id: string },
  topic: string,
  resourcePath: string
): Promise<void> {
  const path = resourcePath.startsWith("/") ? resourcePath : `/${resourcePath}`;
  const externalId = extractExternalId(path);

  const accessToken = await getLatestValidAccessToken(account.id, supabase);
  if (!accessToken) {
    await supabase.from("ml_promotion_webhook_alerts").insert({
      user_id: account.user_id,
      account_id: account.id,
      topic,
      resource_path: path,
      item_id: null,
      external_id: externalId,
      promotion_id: null,
      promotion_type: null,
      status_label: null,
      fetch_error: "token_indisponivel",
      raw_api: null,
    });
    return;
  }

  const res = await fetchMlResourcePath(path, accessToken);
  if (!res.ok) {
    await supabase.from("ml_promotion_webhook_alerts").insert({
      user_id: account.user_id,
      account_id: account.id,
      topic,
      resource_path: path,
      item_id: null,
      external_id: externalId,
      promotion_id: null,
      promotion_type: null,
      status_label: null,
      fetch_error: `http_${res.status}: ${res.body}`,
      raw_api: null,
    });
    return;
  }

  const parsed = parseCandidateOfferBody(res.data);
  await supabase.from("ml_promotion_webhook_alerts").insert({
    user_id: account.user_id,
    account_id: account.id,
    topic,
    resource_path: path,
    item_id: parsed.item_id,
    external_id: externalId,
    promotion_id: parsed.promotion_id,
    promotion_type: parsed.promotion_type,
    status_label: parsed.status_label,
    fetch_error: null,
    raw_api: res.data as object,
  });
}

export function isPromotionPublicWebhookTopic(topic: string): boolean {
  const t = topic.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  return t === "public_candidates" || t === "public_offers";
}
