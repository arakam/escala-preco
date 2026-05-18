import { createClient } from "@/lib/supabase/server";
import { isDevEnvironment } from "@/lib/dev-only";
import { aggregateSales30dFromDb } from "@/lib/mercadolivre/orders-store";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/dev/sales — diagnóstico de vendas persistidas (apenas development).
 */
export async function GET(req: NextRequest) {
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
    .select("id")
    .eq("user_id", user.id)
    .single();
  if (accErr || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "30", 10)));

  const { data: syncState } = await supabase
    .from("ml_sales_sync_state")
    .select("*")
    .eq("account_id", account.id)
    .maybeSingle();

  const { data: recentOrders, error: ordersErr } = await supabase
    .from("ml_orders")
    .select("ml_order_id, status, date_created, synced_at")
    .eq("account_id", account.id)
    .order("date_created", { ascending: false })
    .limit(limit);

  if (ordersErr) {
    console.error("[dev/sales] orders", ordersErr);
    return NextResponse.json({ error: "Erro ao listar pedidos" }, { status: 500 });
  }

  const orderIds = (recentOrders ?? []).map((o) => String(o.ml_order_id));
  let items: Array<Record<string, unknown>> = [];
  if (orderIds.length > 0) {
    const { data: itemRows, error: itemsErr } = await supabase
      .from("ml_order_items")
      .select("ml_order_id, item_id, quantity, unit_price, line_index")
      .eq("account_id", account.id)
      .in("ml_order_id", orderIds)
      .order("item_id", { ascending: true });
    if (itemsErr) {
      console.error("[dev/sales] items", itemsErr);
    } else {
      items = (itemRows ?? []) as Array<Record<string, unknown>>;
    }
  }

  const agg = await aggregateSales30dFromDb(supabase, account.id);
  const topItems = Object.entries(agg.orders)
    .map(([item_id, order_count]) => ({
      item_id,
      order_count,
      quantity: agg.sales[item_id] ?? 0,
    }))
    .sort((a, b) => b.order_count - a.order_count)
    .slice(0, 50);

  return NextResponse.json({
    sync_state: syncState ?? null,
    recent_orders: recentOrders ?? [],
    order_items: items,
    aggregate_30d: topItems,
    has_aggregate_data: agg.hasData,
  });
}
