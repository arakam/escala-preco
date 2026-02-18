import { createClient } from "@/lib/supabase/server";
import { getActiveJob, createJob } from "@/lib/jobs";
import { runSyncJob } from "@/lib/mercadolivre/sync-worker";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/mercadolivre/sync (legado: body { account_id })
 * Redireciona lógica para o mesmo fluxo de POST /api/mercadolivre/[accountId]/sync.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  let body: { account_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const accountId = body.account_id;
  if (!accountId || typeof accountId !== "string") {
    return NextResponse.json({ error: "account_id obrigatório" }, { status: 400 });
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
    runSyncJob(jobId, accountId).catch((e) => console.error("[sync] worker error:", e));
  });
  return NextResponse.json({ job_id: jobId });
}
