import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const HOURS_WINDOW = 24;

/**
 * GET /api/mercadolivre/webhook-notifications
 * Últimas notificações de webhook do ML recebidas nas contas do usuário (janela de 24h).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const since = new Date(Date.now() - HOURS_WINDOW * 60 * 60 * 1000).toISOString();

  const { data: notifications, error } = await supabase
    .from("ml_webhook_notifications")
    .select(
      "id, created_at, account_id, ml_user_id, topic, resource, application_id, attempts, ml_sent_at, actions, notification_id, raw_payload"
    )
    .eq("user_id", user.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[ML webhook-notifications] list:", error);
    return NextResponse.json({ error: "Erro ao listar notificações" }, { status: 500 });
  }

  return NextResponse.json({ notifications: notifications ?? [], since });
}
