import { runSyncJob } from "@/lib/mercadolivre/sync-worker";
import { createServiceClient } from "@/lib/supabase/service";
import { updateJob } from "@/lib/jobs";

/** Evita disparar dois workers para o mesmo job (poll + novo POST). */
const runningSyncJobs = new Set<string>();

/**
 * Marca o job como running e inicia o worker (sem await do trabalho completo).
 * O POST aguarda só o kickoff para o status sair de "queued" antes da resposta.
 */
export async function kickSyncJob(jobId: string, accountId: string): Promise<void> {
  if (runningSyncJobs.has(jobId)) return;
  runningSyncJobs.add(jobId);
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  try {
    await updateJob(supabase, jobId, { status: "running", started_at: now });
    console.log(`[sync] kick job=${jobId} account=${accountId}`);
    void runSyncJob(jobId, accountId).finally(() => {
      runningSyncJobs.delete(jobId);
    });
  } catch (e) {
    runningSyncJobs.delete(jobId);
    console.error(`[sync] falha ao iniciar job=${jobId}:`, e);
    throw e;
  }
}

/** Reagenda worker para job preso em queued (worker anterior não rodou ou processo reiniciou). */
export function restartSyncJobIfStuck(jobId: string, accountId: string): void {
  if (runningSyncJobs.has(jobId)) return;
  console.warn(`[sync] reagendando worker job=${jobId}`);
  void kickSyncJob(jobId, accountId).catch((e) => {
    console.error(`[sync] restart failed job=${jobId}:`, e);
  });
}
