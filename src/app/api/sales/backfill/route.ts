import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runSalesBackfillForAccount } from "@/lib/mercadolivre/orders-store";
import { NextResponse } from "next/server";

/**
 * POST /api/sales/backfill
 * Carga inicial dos últimos 30 dias (pedidos pagos no ML).
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
    .select("id, ml_user_id")
    .eq("user_id", user.id)
    .single();

  if (accErr || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const service = createServiceClient();
  try {
    const result = await runSalesBackfillForAccount(
      service,
      account.id,
      user.id,
      account.ml_user_id as number
    );
    return NextResponse.json({
      ok: true,
      orders_upserted: result.ordersUpserted,
      items_upserted: result.itemsUpserted,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro na carga inicial";
    console.error("[sales/backfill]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
