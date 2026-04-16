/**
 * Helpers para jobs de sincronização (ml_jobs, ml_job_logs).
 * Usar com createClient() do usuário nas rotas ou createServiceClient() no worker.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type JobStatus = "queued" | "running" | "success" | "failed" | "partial";
export type JobType = "sync_items" | "apply_wholesale_prices" | "refresh_price_references";

export interface JobRow {
  id: string;
  account_id: string;
  type: string;
  status: JobStatus;
  total: number;
  processed: number;
  ok: number;
  errors: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

/** Jobs presos após crash do processo, timeout de proxy ou deploy (VPS/serverless). */
const STALE_RUNNING_MS = 8 * 60 * 1000;
const STALE_QUEUED_MS = 5 * 60 * 1000;

/**
 * Marca como failed jobs running há muito tempo ou queued cujo worker nunca iniciou.
 * Evita bloquear novas operações com getActiveJob.
 */
export async function expireStaleJobsForAccount(
  supabase: SupabaseClient,
  accountId: string,
  type: JobType = "sync_items"
): Promise<void> {
  const now = new Date().toISOString();
  const runningCutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString();
  const queuedCutoff = new Date(Date.now() - STALE_QUEUED_MS).toISOString();

  const { data: staleRunning } = await supabase
    .from("ml_jobs")
    .select("id")
    .eq("account_id", accountId)
    .eq("type", type)
    .eq("status", "running")
    .lt("started_at", runningCutoff);

  for (const row of staleRunning ?? []) {
    await updateJob(supabase, row.id, { status: "failed", ended_at: now });
    await addJobLog(supabase, row.id, {
      status: "error",
      message:
        "Operação interrompida (processo encerrado ou tempo excedido). Inicie novamente.",
    });
  }

  const { data: staleQueued } = await supabase
    .from("ml_jobs")
    .select("id")
    .eq("account_id", accountId)
    .eq("type", type)
    .eq("status", "queued")
    .lt("created_at", queuedCutoff);

  for (const row of staleQueued ?? []) {
    await updateJob(supabase, row.id, { status: "failed", ended_at: now });
    await addJobLog(supabase, row.id, {
      status: "error",
      message:
        "Operação não iniciou a tempo. Tente novamente.",
    });
  }
}

export async function getActiveJob(
  supabase: SupabaseClient,
  accountId: string,
  type: JobType = "sync_items"
): Promise<JobRow | null> {
  await expireStaleJobsForAccount(supabase, accountId, type);

  const { data } = await supabase
    .from("ml_jobs")
    .select("*")
    .eq("account_id", accountId)
    .eq("type", type)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as JobRow | null;
}

export async function createJob(
  supabase: SupabaseClient,
  accountId: string,
  type: JobType = "sync_items"
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("ml_jobs")
    .insert({
      account_id: accountId,
      type,
      status: "queued",
      total: 0,
      processed: 0,
      ok: 0,
      errors: 0,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

export async function updateJob(
  supabase: SupabaseClient,
  jobId: string,
  updates: Partial<{
    status: JobStatus;
    total: number;
    processed: number;
    ok: number;
    errors: number;
    started_at: string;
    ended_at: string;
  }>
): Promise<void> {
  const { error } = await supabase.from("ml_jobs").update(updates).eq("id", jobId);
  if (error) throw error;
}

export async function addJobLog(
  supabase: SupabaseClient,
  jobId: string,
  payload: {
    item_id?: string;
    variation_id?: number;
    status: "ok" | "error";
    message?: string;
    response_json?: unknown;
  }
): Promise<void> {
  const { error } = await supabase.from("ml_job_logs").insert({
    job_id: jobId,
    item_id: payload.item_id ?? null,
    variation_id: payload.variation_id ?? null,
    status: payload.status,
    message: payload.message ?? null,
    response_json: payload.response_json ?? null,
  });
  if (error) throw error;
}

export interface JobLogEntry {
  item_id: string | null;
  variation_id: number | null;
  status: string;
  message: string | null;
  created_at: string;
  response_json?: unknown;
}

export async function getJobWithLogs(
  supabase: SupabaseClient,
  jobId: string,
  logsLimit = 50
): Promise<{ job: JobRow | null; logs: JobLogEntry[] }> {
  const { data: job } = await supabase
    .from("ml_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  const { data: logs } = await supabase
    .from("ml_job_logs")
    .select("item_id, variation_id, status, message, created_at, response_json")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(logsLimit);
  return {
    job: job as JobRow | null,
    logs: (logs ?? []) as JobLogEntry[],
  };
}
