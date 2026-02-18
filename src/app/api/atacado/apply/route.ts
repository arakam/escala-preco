import { createClient } from "@/lib/supabase/server";
import { getActiveJob, createJob } from "@/lib/jobs";
import { runApplyWholesaleJob } from "@/lib/mercadolivre/apply-wholesale-worker";
import { NextRequest, NextResponse } from "next/server";

const JOB_TYPE = "apply_wholesale_prices" as const;

/**
 * POST /api/atacado/apply
 * Body: { accountId }
 * Cria job apply_wholesale_prices e dispara worker. Se já existir job queued/running para a conta, reutiliza e retorna seu job_id.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: { accountId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const accountId = body.accountId?.trim();
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

  const active = await getActiveJob(supabase, accountId, JOB_TYPE);
  if (active) {
    return NextResponse.json({ job_id: active.id, message: "Aplicação já em andamento" });
  }

  const { id: jobId } = await createJob(supabase, accountId, JOB_TYPE);
  setImmediate(() => {
    runApplyWholesaleJob(jobId, accountId).catch((e) => console.error("[atacado/apply] worker error:", e));
  });

  return NextResponse.json({ job_id: jobId });
}
