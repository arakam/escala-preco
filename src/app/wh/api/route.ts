import { createServiceClient } from "@/lib/supabase/service";
import {
  isPromotionPublicWebhookTopic,
  resolveAndStorePromotionWebhookAlert,
} from "@/lib/mercadolivre/promotion-webhook-alerts";
import { scheduleItemsWebhookSync } from "@/lib/mercadolivre/webhook-items-sync";
import { schedulePromotionsWebhookCacheRefresh } from "@/lib/mercadolivre/webhook-promotions-sync";
import { processOrdersWebhookSync } from "@/lib/mercadolivre/webhook-orders-sync";
import { NextRequest, NextResponse } from "next/server";

/**
 * Webhook público do Mercado Livre (Callback URL no painel do app).
 * Produção: https://app.escalapreco.com.br/wh/api
 *
 * Log enxuto (sem raw_payload), dedup por notification_id, processamento só em eventos novos.
 */
export async function GET() {
  return NextResponse.json({ ok: true, service: "mercadolivre-webhook" });
}

function normalizeMlUserId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function normalizeApplicationId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function parseMlDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface WebhookAccountRow {
  id: string;
  user_id: string;
  auto_sync_items_webhook?: boolean | null;
  ml_user_id: number;
}

async function persistWebhookLog(
  supabase: ReturnType<typeof createServiceClient>,
  accounts: WebhookAccountRow[],
  fields: {
    mlUserId: number;
    topic: string;
    resource: string | null;
    applicationId: string | null;
    attempts: number | null;
    mlSentAt: string | null;
    actions: unknown;
    notificationId: string | null;
  }
): Promise<{ stored: number; accountIds: Set<string> }> {
  const rows = accounts.map((acc) => ({
    account_id: acc.id,
    user_id: acc.user_id,
    ml_user_id: fields.mlUserId,
    topic: fields.topic,
    resource: fields.resource,
    application_id: fields.applicationId,
    attempts: fields.attempts,
    ml_sent_at: fields.mlSentAt,
    actions: fields.actions as unknown,
    notification_id: fields.notificationId,
  }));

  if (fields.notificationId) {
    const { data, error } = await supabase
      .from("ml_webhook_notifications")
      .upsert(rows, { onConflict: "account_id,notification_id", ignoreDuplicates: true })
      .select("account_id");

    if (error) {
      console.error("[ML webhook] upsert:", error);
      throw error;
    }

    const accountIds = new Set((data ?? []).map((r) => String((r as { account_id: string }).account_id)));
    return { stored: accountIds.size, accountIds };
  }

  const { data, error } = await supabase
    .from("ml_webhook_notifications")
    .insert(rows)
    .select("account_id");

  if (error) {
    console.error("[ML webhook] insert:", error);
    throw error;
  }

  const accountIds = new Set((data ?? []).map((r) => String((r as { account_id: string }).account_id)));
  return { stored: accountIds.size, accountIds };
}

export async function POST(request: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const mlUserId = normalizeMlUserId(payload.user_id);
  if (mlUserId === null) {
    console.warn("[ML webhook] payload sem user_id válido, ignorando persistência");
    return NextResponse.json({ ok: true, stored: 0 });
  }

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch (e) {
    console.error("[ML webhook] service client:", e);
    return NextResponse.json({ error: "Servidor não configurado" }, { status: 503 });
  }

  const { data: accounts, error: accErr } = await supabase
    .from("ml_accounts")
    .select("id, user_id, auto_sync_items_webhook, ml_user_id")
    .eq("ml_user_id", mlUserId);

  if (accErr) {
    console.error("[ML webhook] lookup ml_accounts:", accErr);
    return NextResponse.json({ error: "Erro ao resolver contas" }, { status: 500 });
  }

  if (!accounts?.length) {
    console.warn("[ML webhook] nenhuma conta local para ml_user_id=%s (topic=%s)", mlUserId, payload.topic);
    return NextResponse.json({ ok: true, stored: 0 });
  }

  const topic = typeof payload.topic === "string" && payload.topic ? payload.topic : "unknown";
  const resource = payload.resource != null ? String(payload.resource) : null;
  const applicationId = normalizeApplicationId(payload.application_id);
  const attempts =
    typeof payload.attempts === "number" && Number.isFinite(payload.attempts)
      ? Math.trunc(payload.attempts)
      : null;
  const mlSentAt = parseMlDate(payload.sent);
  const actions = Array.isArray(payload.actions) ? payload.actions : null;
  const notificationId = payload.id != null ? String(payload.id) : null;

  let stored = 0;
  let accountIdsToProcess: WebhookAccountRow[] = accounts;

  try {
    const persisted = await persistWebhookLog(supabase, accounts, {
      mlUserId,
      topic,
      resource,
      applicationId,
      attempts,
      mlSentAt,
      actions,
      notificationId,
    });
    stored = persisted.stored;
    accountIdsToProcess = accounts.filter((a) => persisted.accountIds.has(a.id));
  } catch {
    return NextResponse.json({ error: "Erro ao gravar" }, { status: 500 });
  }

  if (accountIdsToProcess.length === 0) {
    return NextResponse.json({ ok: true, stored: 0, duplicate: true });
  }

  if (resource && isPromotionPublicWebhookTopic(topic)) {
    await Promise.all(
      accountIdsToProcess.map(async (acc) => {
        const resolved = await resolveAndStorePromotionWebhookAlert(supabase, acc, topic, resource);
        schedulePromotionsWebhookCacheRefresh([acc], resolved.item_id);
      })
    ).catch((e) => console.error("[ML webhook] promotion alerts:", e));
  }

  scheduleItemsWebhookSync(accountIdsToProcess, topic, resource);

  try {
    await processOrdersWebhookSync(supabase, accountIdsToProcess, topic, resource);
  } catch (e) {
    console.error("[ML webhook] orders sync:", e);
  }

  return NextResponse.json({ ok: true, stored });
}
