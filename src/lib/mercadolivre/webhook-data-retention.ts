import type { SupabaseClient } from "@supabase/supabase-js";

/** Dias de retenção do log de webhooks (cobre reprocessamento de pedidos em 72h). */
export const WEBHOOK_NOTIFICATIONS_RETENTION_DAYS = 7;

/** Dias de retenção dos alertas derivados de promoção na UI. */
export const PROMOTION_WEBHOOK_ALERTS_RETENTION_DAYS = 30;

const PRUNE_BATCH_SIZE = 5000;

export interface PruneWebhookDataResult {
  notifications_deleted: number;
  alerts_deleted: number;
  notifications_cutoff: string;
  alerts_cutoff: string;
}

function retentionCutoff(days: number): string {
  const d = Math.max(1, Math.trunc(days));
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
}

async function deleteBatch(
  supabase: SupabaseClient,
  table: "ml_webhook_notifications" | "ml_promotion_webhook_alerts",
  cutoffIso: string
): Promise<number> {
  const { data: ids, error: selErr } = await supabase
    .from(table)
    .select("id")
    .lt("created_at", cutoffIso)
    .limit(PRUNE_BATCH_SIZE);

  if (selErr) throw selErr;
  const idList = (ids ?? []).map((r) => (r as { id: string }).id);
  if (idList.length === 0) return 0;

  const { error: delErr } = await supabase.from(table).delete().in("id", idList);
  if (delErr) throw delErr;
  return idList.length;
}

/**
 * Remove registros antigos de webhook e alertas de promoção (em lotes).
 * Preferir `prune_ml_webhook_data` via RPC quando disponível no banco.
 */
export async function pruneWebhookData(
  supabase: SupabaseClient,
  options?: {
    notificationsDays?: number;
    alertsDays?: number;
  }
): Promise<PruneWebhookDataResult> {
  const notificationsDays = options?.notificationsDays ?? WEBHOOK_NOTIFICATIONS_RETENTION_DAYS;
  const alertsDays = options?.alertsDays ?? PROMOTION_WEBHOOK_ALERTS_RETENTION_DAYS;
  const notificationsCutoff = retentionCutoff(notificationsDays);
  const alertsCutoff = retentionCutoff(alertsDays);

  const { data: rpcData, error: rpcErr } = await supabase.rpc("prune_ml_webhook_data", {
    p_notifications_days: notificationsDays,
    p_alerts_days: alertsDays,
    p_batch_size: PRUNE_BATCH_SIZE,
  });

  if (!rpcErr && rpcData && typeof rpcData === "object") {
    const o = rpcData as Record<string, unknown>;
    return {
      notifications_deleted: Number(o.notifications_deleted ?? 0),
      alerts_deleted: Number(o.alerts_deleted ?? 0),
      notifications_cutoff: String(o.notifications_cutoff ?? notificationsCutoff),
      alerts_cutoff: String(o.alerts_cutoff ?? alertsCutoff),
    };
  }

  if (rpcErr) {
    console.warn("[webhook prune] RPC indisponível, fallback TS:", rpcErr.message);
  }

  let notificationsDeleted = 0;
  let alertsDeleted = 0;

  for (;;) {
    const n = await deleteBatch(supabase, "ml_webhook_notifications", notificationsCutoff);
    notificationsDeleted += n;
    if (n < PRUNE_BATCH_SIZE) break;
  }

  for (;;) {
    const n = await deleteBatch(supabase, "ml_promotion_webhook_alerts", alertsCutoff);
    alertsDeleted += n;
    if (n < PRUNE_BATCH_SIZE) break;
  }

  return {
    notifications_deleted: notificationsDeleted,
    alerts_deleted: alertsDeleted,
    notifications_cutoff: notificationsCutoff,
    alerts_cutoff: alertsCutoff,
  };
}
