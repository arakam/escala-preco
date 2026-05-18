import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { syncMlOrderFromApi } from "@/lib/mercadolivre/orders-store";
import { runSyncInBackground } from "@/lib/server/after-response";

export function isOrdersWebhookTopic(topic: string): boolean {
  const t = topic.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  return (
    t === "orders_v2" ||
    t === "orders" ||
    t === "created_orders" ||
    t === "marketplace_orders"
  );
}

/** Ex.: `/orders/123456789` → `123456789` */
export function parseOrderIdFromWebhookResource(resource: string | null): string | null {
  if (!resource) return null;
  const trimmed = resource.trim();
  const match = trimmed.match(/\/orders\/(\d+)/i);
  if (match?.[1]) return match[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  return null;
}

interface WebhookAccountRow {
  id: string;
  user_id: string;
}

export async function syncOrderForAccount(
  supabase: SupabaseClient,
  acc: WebhookAccountRow,
  orderId: string
): Promise<{ ok: boolean; reason?: string }> {
  const { data: tokenData, error: tokenErr } = await supabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", acc.id)
    .single();
  if (tokenErr || !tokenData) {
    const reason = "Token Mercado Livre não encontrado";
    console.warn(`[ML webhook orders] ${reason} account=${acc.id}`);
    return { ok: false, reason };
  }
  const tr = tokenData as { access_token: string; refresh_token: string; expires_at: string };
  const accessToken = await getValidAccessToken(
    acc.id,
    tr.access_token,
    tr.refresh_token,
    tr.expires_at,
    supabase
  );
  if (!accessToken) {
    const reason = "Não foi possível obter access token válido";
    console.warn(`[ML webhook orders] ${reason} account=${acc.id}`);
    return { ok: false, reason };
  }
  const result = await syncMlOrderFromApi(supabase, acc.id, acc.user_id, accessToken, orderId);
  if (result.ok) {
    console.info(
      `[ML webhook orders] sync OK account=${acc.id} order=${orderId} items=${result.item_ids.length}`
    );
    return { ok: true };
  }
  console.warn(`[ML webhook orders] sync falhou account=${acc.id} order=${orderId}: ${result.reason}`);
  return { ok: false, reason: result.reason };
}

/**
 * Sincroniza pedido do webhook antes de responder 200 (evita perder job em background).
 * Em falha, agenda nova tentativa em background.
 */
export async function processOrdersWebhookSync(
  supabase: SupabaseClient,
  accounts: WebhookAccountRow[],
  topic: string,
  resource: string | null
): Promise<void> {
  if (!isOrdersWebhookTopic(topic)) return;
  const orderId = parseOrderIdFromWebhookResource(resource);
  if (!orderId) {
    console.warn("[ML webhook orders] resource sem order_id:", resource);
    return;
  }

  const results = await Promise.all(
    accounts.map((acc) => syncOrderForAccount(supabase, acc, orderId))
  );
  const anyOk = results.some((r) => r.ok);
  if (!anyOk) {
    for (const acc of accounts) {
      runSyncInBackground(() => syncOrderForAccount(supabase, acc, orderId));
    }
  }
}

/** @deprecated Use processOrdersWebhookSync — mantido para imports antigos. */
export function scheduleOrdersWebhookSync(
  supabase: SupabaseClient,
  accounts: WebhookAccountRow[],
  topic: string,
  resource: string | null
): void {
  void processOrdersWebhookSync(supabase, accounts, topic, resource).catch((e) => {
    console.error("[ML webhook orders] processOrdersWebhookSync:", e);
  });
}

/**
 * Reprocessa notificações orders_* recentes cujo pedido ainda não está em ml_orders.
 */
export async function processUnsyncedOrderWebhooks(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  options?: { hoursBack?: number; limit?: number }
): Promise<{ scanned: number; synced: number; failed: number; order_ids: string[] }> {
  const hoursBack = options?.hoursBack ?? 72;
  const limit = options?.limit ?? 80;
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();

  const { data: notifications, error: notifErr } = await supabase
    .from("ml_webhook_notifications")
    .select("resource, topic, created_at")
    .eq("account_id", accountId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  if (notifErr) throw notifErr;

  const orderIdsOrdered: string[] = [];
  const seen = new Set<string>();
  for (const row of notifications ?? []) {
    const topic = String((row as { topic?: string }).topic ?? "");
    if (!isOrdersWebhookTopic(topic)) continue;
    const id = parseOrderIdFromWebhookResource((row as { resource?: string }).resource ?? null);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    orderIdsOrdered.push(id);
  }

  if (orderIdsOrdered.length === 0) {
    return { scanned: 0, synced: 0, failed: 0, order_ids: [] };
  }

  const { data: existing } = await supabase
    .from("ml_orders")
    .select("ml_order_id")
    .eq("account_id", accountId)
    .in("ml_order_id", orderIdsOrdered);

  const have = new Set((existing ?? []).map((r) => String(r.ml_order_id)));
  const missing = orderIdsOrdered.filter((id) => !have.has(id)).slice(0, limit);

  let synced = 0;
  let failed = 0;
  const syncedIds: string[] = [];

  for (const orderId of missing) {
    const result = await syncOrderForAccount(supabase, { id: accountId, user_id: userId }, orderId);
    if (result.ok) {
      synced += 1;
      syncedIds.push(orderId);
    } else {
      failed += 1;
    }
  }

  return { scanned: missing.length, synced, failed, order_ids: syncedIds };
}
