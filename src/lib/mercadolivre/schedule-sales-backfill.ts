import { updateJob } from "@/lib/jobs";
import { runSalesBackfillJob } from "@/lib/mercadolivre/sales-backfill-worker";
import { runSyncInBackground } from "@/lib/server/after-response";
import { createServiceClient } from "@/lib/supabase/service";

const runningBackfills = new Set<string>();

/** Evita dois workers para a mesma conta. */
export async function kickSalesBackfillJob(
  jobId: string,
  accountId: string,
  userId: string,
  mlUserId: number
): Promise<void> {
  if (runningBackfills.has(accountId)) {
    console.warn(`[sales-backfill] já em execução account=${accountId}`);
    return;
  }
  runningBackfills.add(accountId);
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  try {
    await updateJob(supabase, jobId, { status: "running", started_at: now });
    console.log(`[sales-backfill] kick job=${jobId} account=${accountId}`);
    runSyncInBackground(async () => {
      try {
        await runSalesBackfillJob(jobId, accountId, userId, mlUserId);
      } finally {
        runningBackfills.delete(accountId);
      }
    });
  } catch (e) {
    runningBackfills.delete(accountId);
    console.error(`[sales-backfill] falha ao iniciar job=${jobId}:`, e);
    throw e;
  }
}

export function restartSalesBackfillIfStuck(
  jobId: string,
  accountId: string,
  userId: string,
  mlUserId: number
): void {
  if (runningBackfills.has(accountId)) return;
  console.warn(`[sales-backfill] reagendando worker job=${jobId}`);
  void kickSalesBackfillJob(jobId, accountId, userId, mlUserId).catch((e) => {
    console.error(`[sales-backfill] restart failed job=${jobId}:`, e);
  });
}
