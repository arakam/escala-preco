import { createClient } from "@/lib/supabase/server";
import { createJob, getActiveJob } from "@/lib/jobs";
import { isDevEnvironment } from "@/lib/dev-only";
import { kickSalesBackfillJob } from "@/lib/mercadolivre/schedule-sales-backfill";
import { NextResponse } from "next/server";

/**
 * POST /api/dev/sales-backfill
 * Carga inicial dos últimos 30 dias (pedidos pagos) — apenas development.
 */
export async function POST() {
  if (!isDevEnvironment()) {
    return NextResponse.json({ error: "Não disponível" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: account, error: accErr } = await supabase
    .from("ml_accounts")
    .select("id, ml_user_id")
    .eq("user_id", user.id)
    .single();

  if (accErr || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const active = await getActiveJob(supabase, account.id, "sales_backfill_30d");
  if (active) {
    return NextResponse.json({ started: false, job_id: active.id, message: "Já em andamento" });
  }

  const { id: jobId } = await createJob(supabase, account.id, "sales_backfill_30d");
  await kickSalesBackfillJob(jobId, account.id, user.id, account.ml_user_id as number);
  return NextResponse.json({ started: true, job_id: jobId });
}
