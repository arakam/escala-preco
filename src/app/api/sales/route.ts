import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { aggregateSales30dFromDb } from "@/lib/mercadolivre/orders-store";
import {
  listSalesForAccount,
  type SalesListFilters,
  type SalesListStatusFilter,
} from "@/lib/mercadolivre/sales-list";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import {
  enrichOrderLinesWithProfit,
  type OrderLineInput,
} from "@/lib/pricing/order-sales-profit";
import { NextRequest, NextResponse } from "next/server";

function parseSalesListFilters(searchParams: URLSearchParams): SalesListFilters {
  const statusRaw = searchParams.get("status")?.trim() ?? "";
  const status: SalesListStatusFilter =
    statusRaw === "paid" || statusRaw === "cancelled" || statusRaw === "other" ? statusRaw : "";
  const tagsParam = searchParams.get("tags")?.trim() ?? "";
  return {
    search: searchParams.get("search")?.trim() || undefined,
    status,
    dateFrom: searchParams.get("date_from")?.trim() || undefined,
    dateTo: searchParams.get("date_to")?.trim() || undefined,
    dispatchDateFrom: searchParams.get("dispatch_from")?.trim() || undefined,
    dispatchDateTo: searchParams.get("dispatch_to")?.trim() || undefined,
    tags: tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
  };
}

/**
 * GET /api/sales — vendas persistidas (pedidos, agregado 30d, lucro por linha).
 * Filtros (search, status, datas, tags) consultam o banco inteiro, não só os últimos 500 pedidos.
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

  const filters = parseSalesListFilters(req.nextUrl.searchParams);

  const { data: syncState } = await supabase
    .from("ml_sales_sync_state")
    .select("*")
    .eq("account_id", account.id)
    .maybeSingle();

  let listResult;
  try {
    listResult = await listSalesForAccount(supabase, account.id, filters);
  } catch (e) {
    console.error("[sales] list", e);
    return NextResponse.json({ error: "Erro ao listar pedidos" }, { status: 500 });
  }

  const recentOrders = listResult.orders;
  const items: OrderLineInput[] = listResult.items;

  const orderMetaById = new Map<
    string,
    { shipping_cost_sender: number | null; marketplace_fee: number | null }
  >();
  for (const o of recentOrders) {
    orderMetaById.set(String(o.ml_order_id), {
      shipping_cost_sender: o.shipping_cost_sender,
      marketplace_fee: o.marketplace_fee,
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
    recent_orders: recentOrders,
    order_items: items,
    order_items_profit,
    profit_calc_note,
    aggregate_30d: topItems,
    has_aggregate_data: agg.hasData,
    orders_list_mode: listResult.listMode,
    orders_total: listResult.ordersTotal,
    lines_total: listResult.linesTotal,
    recent_limit_hit: listResult.recentLimitHit,
    filtered_max_hit: listResult.filteredMaxHit,
  });
}
