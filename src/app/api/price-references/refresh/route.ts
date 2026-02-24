import { createClient } from "@/lib/supabase/server";
import { getActiveJob, createJob } from "@/lib/jobs";
import { runRefreshPriceReferencesJob } from "@/lib/mercadolivre/price-references-worker";
import { NextRequest, NextResponse } from "next/server";

const JOB_TYPE = "refresh_price_references" as const;

/**
 * POST /api/price-references/refresh
 * Body: { accountId, scope: "all" | "item", item_id?, variation_id? }
 * Cria job refresh_price_references e dispara worker.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: { accountId?: string; scope?: "all" | "item"; item_id?: string; variation_id?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const accountId = body.accountId?.trim();
  const scope = body.scope ?? "all";
  const itemId = body.item_id?.trim();

  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }
  if (scope === "item" && !itemId) {
    return NextResponse.json({ error: "item_id obrigatório quando scope=item" }, { status: 400 });
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
    return NextResponse.json({ job_id: active.id, message: "Refresh já em andamento" });
  }

  const { id: jobId } = await createJob(supabase, accountId, JOB_TYPE);
  setImmediate(() => {
    runRefreshPriceReferencesJob(jobId, accountId, scope, itemId).catch((e) =>
      console.error("[price-references/refresh] worker error:", e)
    );
  });

  return NextResponse.json({ job_id: jobId });
}
