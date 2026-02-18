import { createClient } from "@/lib/supabase/server";
import { getActiveJob, createJob } from "@/lib/jobs";
import { runSyncJob } from "@/lib/mercadolivre/sync-worker";
import { NextRequest, NextResponse } from "next/server";

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

  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const active = await getActiveJob(supabase, accountId);
  if (active) {
    return NextResponse.json({ job_id: active.id, message: "Sincronização já em andamento" });
  }

  const { id: jobId } = await createJob(supabase, accountId);
  setImmediate(() => {
    runSyncJob(jobId, accountId).catch((e) => {
      console.error("[sync] worker error:", e);
    });
  });

  return NextResponse.json({ job_id: jobId });
}
