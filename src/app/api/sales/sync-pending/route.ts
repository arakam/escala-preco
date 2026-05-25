import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processUnsyncedOrderWebhooks } from "@/lib/mercadolivre/webhook-orders-sync";
import { NextResponse } from "next/server";

/**
 * POST /api/sales/sync-pending
 * Reprocessa webhooks orders_v2 recentes que ainda não estão em ml_orders.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: account, error: accErr } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (accErr || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const service = createServiceClient();
  try {
    const result = await processUnsyncedOrderWebhooks(service, account.id, user.id, {
      hoursBack: 72,
      limit: 100,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao reprocessar webhooks";
    console.error("[sales/sync-pending]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
