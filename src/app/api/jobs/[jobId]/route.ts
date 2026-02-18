import { createClient } from "@/lib/supabase/server";
import { getJobWithLogs } from "@/lib/jobs";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/jobs/{jobId}
 * Retorna status do job e últimos logs. Só se o job pertencer ao usuário (via account).
 */
export async function GET(
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

  const { data: job } = await supabase
    .from("ml_jobs")
    .select("id, account_id, type, status, total, processed, ok, errors, started_at, ended_at, created_at")
    .eq("id", jobId)
    .single();
  if (!job) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }

  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("id", job.account_id)
    .eq("user_id", user.id)
    .single();
  if (!account) {
    return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
  }

  const { job: fullJob, logs } = await getJobWithLogs(supabase, jobId);
  return NextResponse.json({
    job: fullJob,
    logs,
  });
}
