import { createJob, getActiveJob, updateJob } from "@/lib/jobs";
import { isSalesBackfillStale } from "@/lib/mercadolivre/orders-store";
import { runSalesBackfillJob } from "@/lib/mercadolivre/sales-backfill-worker";
import { runSyncInBackground } from "@/lib/server/after-response";
import { createServiceClient } from "@/lib/supabase/service";

const BACKFILL_JOB_TYPE = "sales_backfill_30d" as const;

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

export type SalesBackfillKickResult =
  | { started: true; jobId: string }
  | { started: false; reason: string };

/**
 * Dispara carga inicial 30d após sync de anúncios (uma vez por conta, ou retry após erro).
 * Inclui enriquecimento de envio (SLA despacho, modo/tipo, transportadora, frete vendedor).
 */
export async function maybeKickSalesBackfillAfterItemsSync(
  accountId: string,
  options?: { triggerSyncJobId?: string }
): Promise<SalesBackfillKickResult> {
  const supabase = createServiceClient();
  const { data: account } = await supabase
    .from("ml_accounts")
    .select("user_id, ml_user_id")
    .eq("id", accountId)
    .single();

  const userId = (account as { user_id?: string } | null)?.user_id;
  const mlUserId = (account as { ml_user_id?: number } | null)?.ml_user_id;
  if (!userId || mlUserId == null) {
    return { started: false, reason: "conta ML sem user_id ou ml_user_id" };
  }

  const { data: syncState } = await supabase
    .from("ml_sales_sync_state")
    .select("initial_backfill_status, updated_at")
    .eq("account_id", accountId)
    .maybeSingle();

  const backfillStatus = (
    (syncState as { initial_backfill_status?: string } | null)?.initial_backfill_status ?? "idle"
  ).toLowerCase();

  if (backfillStatus === "done") {
    return { started: false, reason: "carga inicial 30d já concluída" };
  }

  if (
    backfillStatus === "running" &&
    !isSalesBackfillStale((syncState as { updated_at?: string } | null)?.updated_at)
  ) {
    return { started: false, reason: "carga inicial 30d em andamento" };
  }

  const activeJob = await getActiveJob(supabase, accountId, BACKFILL_JOB_TYPE);
  if (activeJob) {
    return { started: false, reason: "job sales_backfill_30d ativo" };
  }

  const { id: jobId } = await createJob(supabase, accountId, BACKFILL_JOB_TYPE);
  const trigger = options?.triggerSyncJobId ? ` após sync_items=${options.triggerSyncJobId}` : "";
  console.log(`[sales-backfill] auto-kick job=${jobId} account=${accountId}${trigger}`);
  await kickSalesBackfillJob(jobId, accountId, userId, mlUserId);
  return { started: true, jobId };
}
