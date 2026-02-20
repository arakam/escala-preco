import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export type ActivityType = "sync" | "draft_manual" | "draft_import" | "apply";
export type ActivityStatus = "ok" | "error" | "partial" | "running";

export interface DashboardActivityItem {
  at: string;
  type: ActivityType;
  status: ActivityStatus;
  item_id?: string;
  variation_id?: number | null;
  message: string;
}

export interface DashboardActivityResponse {
  items: DashboardActivityItem[];
}

function mapJobType(type: string): ActivityType {
  if (type === "apply_wholesale_prices") return "apply";
  return "sync";
}

/**
 * GET /api/dashboard/activity?accountId=...&limit=20
 * Retorna últimas atividades: job_logs (sync/apply) + wholesale_drafts (draft_manual/draft_import).
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

  const limit = Math.min(50, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10) || 20));

  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();

  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const items: DashboardActivityItem[] = [];

  // 1) Jobs da conta para obter job_id -> type
  const { data: jobs } = await supabase
    .from("ml_jobs")
    .select("id, type, status")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(100);

  const jobIds = (jobs ?? []).map((j) => j.id);
  const jobById = new Map((jobs ?? []).map((j) => [j.id, j]));

  if (jobIds.length > 0) {
    const { data: logs } = await supabase
      .from("ml_job_logs")
      .select("job_id, item_id, variation_id, status, message, created_at")
      .in("job_id", jobIds)
      .order("created_at", { ascending: false })
      .limit(limit * 2);

    for (const log of logs ?? []) {
      const job = jobById.get(log.job_id);
      if (!job) continue;
      const type = mapJobType(job.type);
      const status: ActivityStatus = log.status === "error" ? "error" : "ok";
      const msg =
        log.message?.trim() ||
        (log.item_id
          ? `${log.item_id}${log.variation_id != null ? ` / var ${log.variation_id}` : ""}`
          : "—");
      items.push({
        at: log.created_at,
        type,
        status,
        item_id: log.item_id ?? undefined,
        variation_id: log.variation_id ?? undefined,
        message: msg,
      });
    }
  }

  // 2) Jobs como eventos (resumo por job) para status running/partial/failed quando não há log
  const { data: jobsFull } = await supabase
    .from("ml_jobs")
    .select("id, type, status, created_at, ended_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(30);

  for (const job of jobsFull ?? []) {
    const type = mapJobType(job.type);
    const status: ActivityStatus =
      job.status === "failed" || job.status === "partial"
        ? job.status
        : job.status === "queued" || job.status === "running"
          ? "running"
          : "ok";
    const at = job.ended_at ?? job.created_at;
    const label =
      job.type === "sync_items" ? "Sincronização" : "Aplicação atacado";
    items.push({
      at,
      type,
      status,
      message: `${label}: ${job.status}`,
    });
  }

  // 3) Wholesale drafts (updated_at)
  const { data: draftUpdates } = await supabase
    .from("wholesale_drafts")
    .select("updated_at, source, item_id, variation_id")
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  for (const d of draftUpdates ?? []) {
    const type: ActivityType = d.source === "import" ? "draft_import" : "draft_manual";
    const msg = d.item_id
      ? `${d.item_id}${d.variation_id != null ? ` / var ${d.variation_id}` : ""}`
      : "Edição rascunho";
    items.push({
      at: d.updated_at,
      type,
      status: "ok",
      item_id: d.item_id ?? undefined,
      variation_id: d.variation_id ?? undefined,
      message: msg,
    });
  }

  // Ordenar por at desc e limitar (remover duplicatas aproximadas por at+type+message)
  const seen = new Set<string>();
  const deduped: DashboardActivityItem[] = [];
  for (const i of items) {
    const key = `${i.at}-${i.type}-${i.item_id ?? ""}-${i.variation_id ?? ""}-${i.message.slice(0, 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(i);
  }
  deduped.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const body: DashboardActivityResponse = {
    items: deduped.slice(0, limit),
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
