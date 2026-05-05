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

/** Tier válido em rascunho: min_qty e price numéricos */
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

/** Tiers vindos do ML em `ml_items.wholesale_prices_json`: { min_purchase_unit, amount } */
function hasValidMlWholesaleTiers(tiers: unknown): boolean {
  if (!Array.isArray(tiers) || tiers.length === 0) return false;
  return tiers.some((t) => {
    if (t == null || typeof t !== "object") return false;
    const o = t as { min_purchase_unit?: unknown; amount?: unknown };
    const minU = Number(o.min_purchase_unit);
    const amt = Number(o.amount);
    return Number.isFinite(minU) && Number.isFinite(amt) && minU > 0 && amt > 0;
  });
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

  // 1–2) Linhas sincronizadas (mesma regra da grade atacado) e quantas têm atacado:
  //      rascunho válido em wholesale_drafts OU preço por quantidade vindo do ML (wholesale_prices_json na sync).
  const [{ data: items }, { data: variationRows }, { data: drafts }] = await Promise.all([
    supabase
      .from("ml_items")
      .select("item_id, has_variations, wholesale_prices_json")
      .eq("account_id", accountId),
    supabase.from("ml_variations").select("item_id, variation_id").eq("account_id", accountId),
    supabase.from("wholesale_drafts").select("item_id, variation_id, tiers_json").eq("account_id", accountId),
  ]);

  const validDraftKeys = new Set<string>();
  for (const d of drafts ?? []) {
    if (!hasValidTier(d.tiers_json)) continue;
    const iid = String(d.item_id).trim().toUpperCase();
    if (d.variation_id == null) validDraftKeys.add(`${iid}:item`);
    else validDraftKeys.add(`${iid}:${Number(d.variation_id)}`);
  }

  const varsByItem = new Map<string, number[]>();
  for (const v of variationRows ?? []) {
    const id = v.item_id as string;
    const list = varsByItem.get(id) ?? [];
    list.push(Number(v.variation_id));
    varsByItem.set(id, list);
  }

  let synced_count = 0;
  let wholesale_configured_count = 0;

  for (const row of items ?? []) {
    const itemId = row.item_id as string;
    const upper = String(itemId).trim().toUpperCase();
    const hasVar = !!row.has_variations;
    const mlWholesale = hasValidMlWholesaleTiers(row.wholesale_prices_json);

    if (!hasVar) {
      synced_count += 1;
      const draftOk = validDraftKeys.has(`${upper}:item`);
      if (draftOk || mlWholesale) wholesale_configured_count += 1;
      continue;
    }

    const varIds = varsByItem.get(itemId) ?? [];
    for (const vid of varIds) {
      synced_count += 1;
      const draftOk =
        validDraftKeys.has(`${upper}:${vid}`) || validDraftKeys.has(`${upper}:item`);
      if (draftOk || mlWholesale) wholesale_configured_count += 1;
    }
  }

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
