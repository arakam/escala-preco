import { createClient } from "@/lib/supabase/server";
import { getActiveJob, createJob, needsSyncWorkerRestart } from "@/lib/jobs";
import { kickSyncJob, restartSyncJobIfStuck } from "@/lib/mercadolivre/schedule-sync";
import { NextRequest, NextResponse } from "next/server";

async function assertAccountAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  userId: string
) {
  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", userId)
    .single();
  return account;
}

/**
 * GET /api/mercadolivre/{accountId}/sync
 * Retorna o job sync_items ativo (queued/running), se houver.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { accountId } = await params;
  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }

  const account = await assertAccountAccess(supabase, accountId, user.id);
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const active = await getActiveJob(supabase, accountId);
  if (active && needsSyncWorkerRestart(active)) {
    restartSyncJobIfStuck(active.id, accountId);
  }

  return NextResponse.json({ job: active });
}

/**
 * POST /api/mercadolivre/{accountId}/sync
 * Cria um job sync_items (ou retorna o ativo) e inicia o processamento em background.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { accountId } = await params;
  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }

  const account = await assertAccountAccess(supabase, accountId, user.id);
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const active = await getActiveJob(supabase, accountId);
  if (active) {
    if (needsSyncWorkerRestart(active)) {
      restartSyncJobIfStuck(active.id, accountId);
    }
    return NextResponse.json({ job_id: active.id, message: "Sincronização já em andamento" });
  }

  const { id: jobId } = await createJob(supabase, accountId);
  await kickSyncJob(jobId, accountId);

  return NextResponse.json({ job_id: jobId });
}
