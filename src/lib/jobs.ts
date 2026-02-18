/**
 * Helpers para jobs de sincronização (ml_jobs, ml_job_logs).
 * Usar com createClient() do usuário nas rotas ou createServiceClient() no worker.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type JobStatus = "queued" | "running" | "success" | "failed" | "partial";
export type JobType = "sync_items";

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

export async function getActiveJob(
  supabase: SupabaseClient,
  accountId: string,
  type: JobType = "sync_items"
): Promise<JobRow | null> {
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

export async function getJobWithLogs(
  supabase: SupabaseClient,
  jobId: string,
  logsLimit = 50
): Promise<{ job: JobRow | null; logs: Array<{ item_id: string | null; variation_id: number | null; status: string; message: string | null; created_at: string }> }> {
  const { data: job } = await supabase
    .from("ml_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  const { data: logs } = await supabase
    .from("ml_job_logs")
    .select("item_id, variation_id, status, message, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(logsLimit);
  return {
    job: job as JobRow | null,
    logs: (logs ?? []) as Array<{ item_id: string | null; variation_id: number | null; status: string; message: string | null; created_at: string }>,
  };
}
