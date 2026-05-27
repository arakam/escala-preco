import { createClient } from "@/lib/supabase/server";
import {
  createJob,
  getActiveJob,
  needsSyncWorkerRestart,
  type JobRow,
} from "@/lib/jobs";
import { isSalesBackfillStale } from "@/lib/mercadolivre/orders-store";
import {
  kickSalesBackfillJob,
  restartSalesBackfillIfStuck,
} from "@/lib/mercadolivre/schedule-sales-backfill";
import { NextResponse } from "next/server";

const BACKFILL_JOB_TYPE = "sales_backfill_30d" as const;

async function getAccountForUser(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: account, error } = await supabase
    .from("ml_accounts")
    .select("id, ml_user_id")
    .eq("user_id", userId)
    .single();
  if (error || !account) return null;
  return account as { id: string; ml_user_id: number };
}

function syncStateIndicatesRunning(status: string | undefined, updatedAt: string | null | undefined): boolean {
  return (status ?? "").toLowerCase() === "running" && !isSalesBackfillStale(updatedAt);
}

/**
 * GET /api/sales/backfill — estado da carga inicial e job ativo (se houver).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const account = await getAccountForUser(supabase, user.id);
  if (!account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const { data: syncState } = await supabase
    .from("ml_sales_sync_state")
    .select("*")
    .eq("account_id", account.id)
    .maybeSingle();

  let job = (await getActiveJob(supabase, account.id, BACKFILL_JOB_TYPE)) as JobRow | null;
  if (job && needsSyncWorkerRestart(job)) {
    restartSalesBackfillIfStuck(job.id, account.id, user.id, account.ml_user_id);
  }

  const running =
    Boolean(job) ||
    syncStateIndicatesRunning(
      (syncState as { initial_backfill_status?: string } | null)?.initial_backfill_status,
      (syncState as { updated_at?: string } | null)?.updated_at
    );

  return NextResponse.json({
    running,
    sync_state: syncState ?? null,
    job,
  });
}

/**
 * POST /api/sales/backfill
 * Inicia carga inicial dos últimos 30 dias em background (resposta imediata).
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const account = await getAccountForUser(supabase, user.id);
  if (!account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const { data: syncState } = await supabase
    .from("ml_sales_sync_state")
    .select("initial_backfill_status, updated_at")
    .eq("account_id", account.id)
    .maybeSingle();

  const activeJob = await getActiveJob(supabase, account.id, BACKFILL_JOB_TYPE);
  if (activeJob) {
    if (needsSyncWorkerRestart(activeJob)) {
      restartSalesBackfillIfStuck(activeJob.id, account.id, user.id, account.ml_user_id);
    }
    return NextResponse.json({
      started: false,
      job_id: activeJob.id,
      message: "Carga inicial já em andamento",
    });
  }

  if (
    syncStateIndicatesRunning(
      (syncState as { initial_backfill_status?: string } | null)?.initial_backfill_status,
      (syncState as { updated_at?: string } | null)?.updated_at
    )
  ) {
    return NextResponse.json({
      started: false,
      message: "Carga inicial já em andamento (sem job ativo — aguarde ou tente novamente em alguns minutos)",
    });
  }

  const { id: jobId } = await createJob(supabase, account.id, BACKFILL_JOB_TYPE);
  await kickSalesBackfillJob(jobId, account.id, user.id, account.ml_user_id);

  return NextResponse.json({
    started: true,
    job_id: jobId,
    message: "Carga inicial iniciada em segundo plano",
  });
}
