import { createClient } from "@/lib/supabase/server";
import { isDevEnvironment } from "@/lib/dev-only";
import { getMlAccountAndAccessToken } from "@/lib/mercadolivre/account-token";
import { syncMissingPaidOrdersLastNDays } from "@/lib/mercadolivre/orders-store";
import { buildRecebimentoRows } from "@/lib/recebimento/build-recebimento-rows";
import { summarizeRecebimentoRows } from "@/lib/recebimento/summarize";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/dev/recebimento — recebíveis por pedido (ML orders + billing). Apenas development.
 * Query: limit (1–150, default 120), date (YYYY-MM-DD, opcional — summary do dia)
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

  const auth = await getMlAccountAndAccessToken(user.id, supabase);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const limit = Math.min(
    150,
    Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "120", 10))
  );

  const since = new Date();
  since.setDate(since.getDate() - 35);
  const sinceIso = since.toISOString();
  const dateParam = req.nextUrl.searchParams.get("date")?.trim() ?? "";
  const summaryDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
    ? dateParam
    : new Date().toISOString().slice(0, 10);

  const { data: recentOrders, error: ordersErr } = await supabase
    .from("ml_orders")
    .select("ml_order_id, status, date_created, marketplace_fee, shipping_cost_sender")
    .eq("account_id", auth.account.id)
    .eq("status", "paid")
    .gte("date_created", sinceIso)
    .order("date_created", { ascending: false })
    .limit(limit);

  if (ordersErr) {
    console.error("[dev/recebimento] orders", ordersErr);
    return NextResponse.json({ error: "Erro ao listar pedidos" }, { status: 500 });
  }

  const orders = (recentOrders ?? []).map((o) => ({
    ml_order_id: String(o.ml_order_id),
    status: String(o.status ?? "unknown"),
    date_created: String(o.date_created),
    marketplace_fee:
      o.marketplace_fee != null && Number.isFinite(Number(o.marketplace_fee))
        ? Number(o.marketplace_fee)
        : null,
    shipping_cost_sender:
      o.shipping_cost_sender != null && Number.isFinite(Number(o.shipping_cost_sender))
        ? Number(o.shipping_cost_sender)
        : null,
  }));

  const orderIds = orders.map((o) => o.ml_order_id);
  let itemRows: {
    ml_order_id: string;
    item_id: string;
    quantity: number;
    unit_price: number | null;
    sale_fee: number | null;
    line_index: number;
  }[] = [];

  if (orderIds.length > 0) {
    const { data: dbItems, error: itemsErr } = await supabase
      .from("ml_order_items")
      .select("ml_order_id, item_id, quantity, unit_price, sale_fee, line_index")
      .eq("account_id", auth.account.id)
      .in("ml_order_id", orderIds)
      .order("line_index", { ascending: true });

    if (itemsErr) {
      console.error("[dev/recebimento] items", itemsErr);
    } else {
      itemRows = (dbItems ?? []).map((row) => ({
        ml_order_id: String(row.ml_order_id),
        item_id: String(row.item_id).trim().toUpperCase(),
        quantity: Number(row.quantity) > 0 ? Math.trunc(Number(row.quantity)) : 1,
        unit_price:
          row.unit_price != null && Number.isFinite(Number(row.unit_price))
            ? Number(row.unit_price)
            : null,
        sale_fee:
          row.sale_fee != null && Number.isFinite(Number(row.sale_fee))
            ? Number(row.sale_fee)
            : null,
        line_index: Number(row.line_index) || 0,
      }));
    }
  }

  if (orders.length === 0) {
    return NextResponse.json({
      rows: [],
      summary: summarizeRecebimentoRows([], summaryDate),
      meta: {
        orders_loaded: 0,
        billing_error: null,
        billing_forbidden: false,
        orders_from_api: 0,
      },
    });
  }

  const built = await buildRecebimentoRows({
    supabase: auth.adminSupabase,
    accountId: auth.account.id,
    accessToken: auth.accessToken,
    orders,
    items: itemRows,
  });

  return NextResponse.json({
    rows: built.rows,
    summary: summarizeRecebimentoRows(built.rows, summaryDate),
    meta: {
      orders_loaded: orders.length,
      billing_error: built.billing_error,
      billing_forbidden: built.billing_forbidden,
      orders_from_api: built.orders_from_api,
    },
  });
}

/**
 * POST /api/dev/recebimento — sincroniza pedidos pagos dos últimos N dias que ainda não estão em `ml_orders`.
 * Body JSON: `{ "days": 35 }` (opcional, 1–90, padrão 35). Apenas development.
 */
export async function POST(req: NextRequest) {
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

  const auth = await getMlAccountAndAccessToken(user.id, supabase);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let days = 35;
  try {
    const body = (await req.json()) as { days?: unknown };
    if (body?.days != null) {
      const n = parseInt(String(body.days), 10);
      if (Number.isFinite(n)) days = n;
    }
  } catch {
    /* corpo vazio ou não JSON: mantém padrão */
  }
  days = Math.min(90, Math.max(1, days));

  try {
    const result = await syncMissingPaidOrdersLastNDays(
      auth.adminSupabase,
      auth.account.id,
      user.id,
      auth.accessToken,
      auth.account.ml_user_id,
      days
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[dev/recebimento] POST sync", e);
    return NextResponse.json({ ok: false, error: msg.slice(0, 500) }, { status: 500 });
  }
}
