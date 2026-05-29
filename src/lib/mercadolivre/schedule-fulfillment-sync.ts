import { runFulfillmentSyncJob } from "@/lib/mercadolivre/fulfillment-sync-worker";
import { createServiceClient } from "@/lib/supabase/service";
import { createJob, getActiveJob, updateJob } from "@/lib/jobs";

const JOB_TYPE = "sync_fulfillment_stock" as const;

const runningFulfillmentJobs = new Set<string>();

export async function kickFulfillmentSyncJob(jobId: string, accountId: string): Promise<void> {
  if (runningFulfillmentJobs.has(jobId)) return;
  runningFulfillmentJobs.add(jobId);
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  try {
    await updateJob(supabase, jobId, { status: "running", started_at: now, phase: "fulfillment" });
    console.log(`[fulfillment-sync] kick job=${jobId} account=${accountId}`);
    void runFulfillmentSyncJob(jobId, accountId).finally(() => {
      runningFulfillmentJobs.delete(jobId);
    });
  } catch (e) {
    runningFulfillmentJobs.delete(jobId);
    console.error(`[fulfillment-sync] falha ao iniciar job=${jobId}:`, e);
    throw e;
  }
}

export function restartFulfillmentSyncIfStuck(jobId: string, accountId: string): void {
  if (runningFulfillmentJobs.has(jobId)) return;
  console.warn(`[fulfillment-sync] reagendando worker job=${jobId}`);
  void kickFulfillmentSyncJob(jobId, accountId).catch((e) => {
    console.error(`[fulfillment-sync] restart failed job=${jobId}:`, e);
  });
}

export type FulfillmentSyncKickResult =
  | { started: true; jobId: string; total: number }
  | { started: false; reason: string; jobId?: string };

/**
 * Dispara job de estoque Full após sync_items (fase A).
 * Não bloqueia — roda em paralelo enquanto o usuário usa o sistema.
 */
export async function maybeKickFulfillmentStockSync(
  accountId: string,
  itemIds: string[],
  options?: { triggerSyncJobId?: string }
): Promise<FulfillmentSyncKickResult> {
  const uniqueIds = Array.from(new Set(itemIds.map((id) => String(id).trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { started: false, reason: "nenhum anúncio Full pendente" };
  }

  const supabase = createServiceClient();
  const active = await getActiveJob(supabase, accountId, JOB_TYPE);
  if (active) {
    return {
      started: false,
      reason: "job de estoque Full já em andamento",
      jobId: active.id,
    };
  }

  const { id: jobId } = await createJob(supabase, accountId, JOB_TYPE);
  await updateJob(supabase, jobId, {
    total: uniqueIds.length,
    meta_json: {
      item_ids: uniqueIds,
      trigger_sync_job_id: options?.triggerSyncJobId ?? null,
    },
  });

  await kickFulfillmentSyncJob(jobId, accountId);
  console.log(
    `[fulfillment-sync] iniciado job=${jobId} account=${accountId} itens=${uniqueIds.length}` +
      (options?.triggerSyncJobId ? ` após sync_items=${options.triggerSyncJobId}` : "")
  );

  return { started: true, jobId, total: uniqueIds.length };
}
