import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { aggregateSales30dFromDb } from "@/lib/mercadolivre/orders-store";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import {
  enrichOrderLinesWithProfit,
  type OrderLineInput,
} from "@/lib/pricing/order-sales-profit";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/sales — vendas persistidas (pedidos, agregado 30d, lucro por linha).
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: account, error: accErr } = await supabase
    .from("ml_accounts")
    .select("id, site_id, ml_user_id")
    .eq("user_id", user.id)
    .single();
  if (accErr || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const limit = Math.min(500, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "200", 10)));

  const { data: syncState } = await supabase
    .from("ml_sales_sync_state")
    .select("*")
    .eq("account_id", account.id)
    .maybeSingle();

  const { data: recentOrders, error: ordersErr } = await supabase
    .from("ml_orders")
    .select(
      "ml_order_id, status, date_created, synced_at, shipping_id, shipping_logistic_mode, shipping_logistic_type, shipping_carrier, shipping_cost_sender, marketplace_fee, tags"
    )
    .eq("account_id", account.id)
    .order("date_created", { ascending: false })
    .limit(limit);

  if (ordersErr) {
    console.error("[sales] orders", ordersErr);
    return NextResponse.json({ error: "Erro ao listar pedidos" }, { status: 500 });
  }

  const orderIds = (recentOrders ?? []).map((o) => String(o.ml_order_id));
  let items: OrderLineInput[] = [];
  if (orderIds.length > 0) {
    const { data: itemRows, error: itemsErr } = await supabase
      .from("ml_order_items")
      .select("ml_order_id, item_id, variation_id, quantity, unit_price, line_index, sale_fee")
      .eq("account_id", account.id)
      .in("ml_order_id", orderIds)
      .order("line_index", { ascending: true });
    if (itemsErr) {
      console.error("[sales] items", itemsErr);
    } else {
      items = (itemRows ?? []).map((row) => ({
        ml_order_id: String(row.ml_order_id),
        item_id: String(row.item_id).trim().toUpperCase(),
        variation_id:
          row.variation_id != null &&
          Number.isFinite(Number(row.variation_id)) &&
          Number(row.variation_id) > 0
            ? Math.trunc(Number(row.variation_id))
            : null,
        quantity: Number(row.quantity) > 0 ? Math.trunc(Number(row.quantity)) : 1,
        unit_price:
          row.unit_price != null && Number.isFinite(Number(row.unit_price))
            ? Number(row.unit_price)
            : null,
        line_index: Number(row.line_index) || 0,
        sale_fee:
          row.sale_fee != null && Number.isFinite(Number(row.sale_fee))
            ? Number(row.sale_fee)
            : null,
      }));
    }
  }

  const orderMetaById = new Map<
    string,
    { shipping_cost_sender: number | null; marketplace_fee: number | null }
  >();
  for (const o of recentOrders ?? []) {
    orderMetaById.set(String(o.ml_order_id), {
      shipping_cost_sender:
        o.shipping_cost_sender != null && Number.isFinite(Number(o.shipping_cost_sender))
          ? Number(o.shipping_cost_sender)
          : null,
      marketplace_fee:
        o.marketplace_fee != null && Number.isFinite(Number(o.marketplace_fee))
          ? Number(o.marketplace_fee)
          : null,
    });
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

  let order_items_profit: Awaited<ReturnType<typeof enrichOrderLinesWithProfit>> = [];
  let profit_calc_note: string | null = null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (items.length > 0 && supabaseUrl && supabaseServiceKey) {
    const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);
    const { data: tokenData } = await adminSupabase
      .from("ml_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("account_id", account.id)
      .maybeSingle();

    let accessToken: string | null = null;
    if (tokenData) {
      accessToken = await getValidAccessToken(
        account.id,
        tokenData.access_token,
        tokenData.refresh_token,
        tokenData.expires_at,
        adminSupabase
      );
    }

    let isMercadoLider = false;
    if (accessToken && account.ml_user_id) {
      try {
        const repRes = await fetch(
          `https://api.mercadolibre.com/users/${account.ml_user_id}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (repRes.ok) {
          const repJson = (await repRes.json()) as {
            seller_reputation?: { power_seller_status?: string | null };
          };
          const power = repJson.seller_reputation?.power_seller_status?.toLowerCase() ?? "";
          isMercadoLider = power === "gold" || power === "platinum";
        }
      } catch {
        // frete sem flag Líder
      }
    }

    if (accessToken) {
      try {
        order_items_profit = await enrichOrderLinesWithProfit(
          adminSupabase,
          account.id,
          account.site_id || "MLB",
          accessToken,
          isMercadoLider,
          items,
          orderMetaById
        );
      } catch (e) {
        console.error("[sales] profit enrichment", e);
        profit_calc_note = "Erro ao calcular lucro das linhas";
      }
    } else {
      profit_calc_note = "Token ML indisponível — lucro não calculado";
    }
  }

  return NextResponse.json({
    sync_state: syncState ?? null,
    recent_orders: recentOrders ?? [],
    order_items: items,
    order_items_profit,
    profit_calc_note,
    aggregate_30d: topItems,
    has_aggregate_data: agg.hasData,
  });
}
