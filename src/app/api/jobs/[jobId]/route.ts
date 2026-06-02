import { createClient } from "@/lib/supabase/server";
import {
  expireStaleJobsForAccount,
  getJobWithLogs,
  needsSyncWorkerRestart,
  updateJob,
} from "@/lib/jobs";
import { restartSyncJobIfStuck } from "@/lib/mercadolivre/schedule-sync";
import { NextRequest, NextResponse } from "next/server";

async function getJobAndCheckOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  userId: string
) {
  const { data: job } = await supabase
    .from("ml_jobs")
    .select("id, account_id, type, status, total, processed, ok, errors, started_at, ended_at, created_at")
    .eq("id", jobId)
    .single();
  if (!job) return { job: null as { account_id: string } | null };
  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("id", job.account_id)
    .eq("user_id", userId)
    .single();
  if (!account) return { job: null as { account_id: string } | null };
  return { job: job as { account_id: string } };
}

/**
 * GET /api/jobs/{jobId}
 * Retorna status do job e últimos logs. Só se o job pertencer ao usuário (via account).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "jobId obrigatório" }, { status: 400 });
  }

  const { job } = await getJobAndCheckOwnership(supabase, jobId, user.id);
  if (!job) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }

  const accountId = job.account_id;
  await expireStaleJobsForAccount(supabase, accountId, "sync_items");
  await expireStaleJobsForAccount(supabase, accountId, "sync_fulfillment_stock");

  const logsParam = request.nextUrl.searchParams.get("logs")?.trim();
  const logsLimit = logsParam === "all" ? ("all" as const) : 50;

  const { job: fullJob, logs } = await getJobWithLogs(supabase, jobId, logsLimit);
  if (fullJob && fullJob.type === "sync_items" && needsSyncWorkerRestart(fullJob)) {
    restartSyncJobIfStuck(jobId, accountId);
  }
  if (fullJob && fullJob.type === "sync_fulfillment_stock" && needsSyncWorkerRestart(fullJob)) {
    const { restartFulfillmentSyncIfStuck } = await import(
      "@/lib/mercadolivre/schedule-fulfillment-sync"
    );
    restartFulfillmentSyncIfStuck(jobId, accountId);
  }
  return NextResponse.json({
    job: fullJob,
    logs,
  });
}

/**
 * PATCH /api/jobs/{jobId}
 * Marca um job queued/running como "finalizado pelo usuário" (status failed + ended_at).
 * Assim o próximo sync não reutiliza esse job e cria um novo.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { jobId } = await params;
  if (!jobId) {
    return NextResponse.json({ error: "jobId obrigatório" }, { status: 400 });
  }

  const { job } = await getJobAndCheckOwnership(supabase, jobId, user.id);
  if (!job) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }

  const { data: current } = await supabase
    .from("ml_jobs")
    .select("status")
    .eq("id", jobId)
    .single();
  if (!current || !["queued", "running"].includes((current as { status: string }).status)) {
    return NextResponse.json({ error: "Job já está finalizado" }, { status: 400 });
  }

  const now = new Date().toISOString();
  await updateJob(supabase, jobId, { status: "failed", ended_at: now });
  return NextResponse.json({ ok: true });
}
