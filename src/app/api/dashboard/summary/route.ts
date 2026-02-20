import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export interface DashboardSummaryResponse {
  account: { id: string; ml_user_id: number; ml_nickname: string | null };
  cards: {
    synced_count: number;
    wholesale_configured_count: number;
    wholesale_missing_count: number;
    errors_or_pending_count: number;
  };
}

/** Tier válido: objeto com min_qty e price numéricos */
function hasValidTier(tiers: unknown): boolean {
  if (!Array.isArray(tiers) || tiers.length === 0) return false;
  return tiers.some(
    (t) =>
      t != null &&
      typeof t === "object" &&
      typeof (t as { min_qty?: unknown }).min_qty === "number" &&
      typeof (t as { price?: unknown }).price === "number"
  );
}

/**
 * GET /api/dashboard/summary?accountId=...
 * Retorna resumo para os cards: synced (linhas achatadas), com atacado, sem atacado, erros/pendências.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId")?.trim();
  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id, ml_user_id, ml_nickname")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  // 1) Total de linhas editáveis achatadas: itens sem variação (1 cada) + variações dos itens com variação
  const { count: countNoVar } = await supabase
    .from("ml_items")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("has_variations", false);

  const { data: itemsWithVar } = await supabase
    .from("ml_items")
    .select("item_id")
    .eq("account_id", accountId)
    .eq("has_variations", true);

  let varCount = 0;
  if (itemsWithVar && itemsWithVar.length > 0) {
    const itemIds = itemsWithVar.map((i) => i.item_id);
    const { count } = await supabase
      .from("ml_variations")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .in("item_id", itemIds);
    varCount = count ?? 0;
  }

  const synced_count = (countNoVar ?? 0) + varCount;

  // 2) Com atacado configurado: drafts com tiers_json com pelo menos 1 tier válido
  const { data: drafts } = await supabase
    .from("wholesale_drafts")
    .select("tiers_json")
    .eq("account_id", accountId);

  const wholesale_configured_count = (drafts ?? []).filter((d) =>
    hasValidTier(d.tiers_json)
  ).length;

  const wholesale_missing_count = Math.max(0, synced_count - wholesale_configured_count);

  // 3) Erros/Pendências: job_logs status error últimos 7 dias + jobs failed/partial últimos 7 dias
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: jobsForLogs } = await supabase
    .from("ml_jobs")
    .select("id")
    .eq("account_id", accountId)
    .gte("created_at", sevenDaysAgo);

  let logErrors = 0;
  if (jobsForLogs && jobsForLogs.length > 0) {
    const jobIds = jobsForLogs.map((j) => j.id);
    const { count } = await supabase
      .from("ml_job_logs")
      .select("id", { count: "exact", head: true })
      .in("job_id", jobIds)
      .eq("status", "error");
    logErrors = count ?? 0;
  }

  const { count: failedJobsCount } = await supabase
    .from("ml_jobs")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .in("status", ["failed", "partial"])
    .gte("created_at", sevenDaysAgo);

  const errors_or_pending_count = logErrors + (failedJobsCount ?? 0);

  const body: DashboardSummaryResponse = {
    account: {
      id: account.id,
      ml_user_id: account.ml_user_id,
      ml_nickname: account.ml_nickname ?? null,
    },
    cards: {
      synced_count,
      wholesale_configured_count,
      wholesale_missing_count,
      errors_or_pending_count,
    },
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
