import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const DEFAULT_HOURS = 72;

/**
 * GET /api/mercadolivre/promotion-alerts?accountId=&hours=
 * Avisos de webhook public_candidates / public_offers recentes.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId")?.trim();
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

  const hours = Math.min(
    168,
    Math.max(1, parseInt(searchParams.get("hours") ?? String(DEFAULT_HOURS), 10) || DEFAULT_HOURS)
  );
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data: alerts, error } = await supabase
    .from("ml_promotion_webhook_alerts")
    .select(
      "id, created_at, item_id, topic, promotion_type, status_label, fetch_error, external_id, promotion_id"
    )
    .eq("account_id", accountId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[promotion-alerts]", error);
    return NextResponse.json({ error: "Erro ao listar avisos" }, { status: 500 });
  }

  return NextResponse.json({ alerts: alerts ?? [], since, hours });
}
