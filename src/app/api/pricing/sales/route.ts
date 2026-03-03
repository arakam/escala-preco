import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";

const BATCH_SIZE = 10;
const MAX_ITEMS = 100;

export interface SalesForItem {
  quantity: number;
  orders: number;
}

/**
 * Chama a API de orders do ML e retorna quantidade vendida e número de pedidos para o item.
 * Considera apenas pedidos com status "paid".
 */
async function fetchSalesForItem(
  accessToken: string,
  sellerId: number,
  itemId: string,
  dateFrom: string,
  dateTo: string
): Promise<SalesForItem> {
  const url = new URL("https://api.mercadolibre.com/orders/search");
  url.searchParams.set("seller", String(sellerId));
  url.searchParams.set("item", itemId);
  url.searchParams.set("date_created.from", dateFrom);
  url.searchParams.set("date_created.to", dateTo);
  url.searchParams.set("limit", "51"); // API ML: máximo 51 para orders/search

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[pricing/sales] orders/search ${res.status} for ${itemId}:`, errText.slice(0, 200));
    return { quantity: 0, orders: 0 };
  }

  let data: {
    results?: Array<{
      status?: string;
      order_items?: Array<{ item?: { id?: string }; quantity?: number }>;
    }>;
  };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { quantity: 0, orders: 0 };
  }

  const results = data.results ?? [];
  let quantity = 0;
  let orders = 0;
  for (const order of results) {
    if (order.status !== "paid") continue;
    const items = order.order_items ?? [];
    let orderHasItem = false;
    for (const oi of items) {
      if (oi.item?.id === itemId && typeof oi.quantity === "number") {
        quantity += oi.quantity;
        orderHasItem = true;
      }
    }
    if (orderHasItem) orders += 1;
  }
  return { quantity, orders };
}

export interface SalesMaps {
  sales: Record<string, number>;
  orders: Record<string, number>;
}

/** Usado pelo servidor (ex.: listings com order_by sales) para obter vendas e pedidos de muitos itens. */
export async function getSalesMap(
  accessToken: string,
  sellerId: number,
  itemIds: string[],
  dateFrom: string,
  dateTo: string
): Promise<SalesMaps> {
  const sales: Record<string, number> = {};
  const orders: Record<string, number> = {};
  const unique = [...new Set(itemIds)];
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((id) =>
        fetchSalesForItem(accessToken, sellerId, id, dateFrom, dateTo)
      )
    );
    batch.forEach((id, j) => {
      sales[id] = results[j].quantity;
      orders[id] = results[j].orders;
    });
  }
  return { sales, orders };
}

/**
 * GET /api/pricing/sales?item_ids=MLB1,MLB2,... (máx 100; URL longa pode falhar em alguns servidores)
 * POST /api/pricing/sales body: { item_ids: ["MLB1", ...] } (recomendado para muitos itens)
 */
async function handleSalesRequest(req: NextRequest, itemIds: string[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  if (itemIds.length === 0) {
    return NextResponse.json({ sales: {}, orders: {} });
  }
  if (itemIds.length > MAX_ITEMS) {
    return NextResponse.json(
      { error: `Máximo de ${MAX_ITEMS} itens por requisição` },
      { status: 400 }
    );
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id, ml_user_id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Configuração do servidor incompleta" }, { status: 500 });
  }

  const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);
  const { data: tokenData, error: tokenError } = await adminSupabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", account.id)
    .single();

  if (tokenError || !tokenData) {
    return NextResponse.json({ error: "Token não encontrado" }, { status: 404 });
  }

  const token = tokenData as { access_token: string; refresh_token: string; expires_at: string };
  const accessToken = await getValidAccessToken(
    account.id,
    token.access_token,
    token.refresh_token,
    token.expires_at,
    adminSupabase
  );

  if (!accessToken) {
    return NextResponse.json({ error: "Falha ao obter token válido" }, { status: 401 });
  }

  const sellerId = account.ml_user_id as number;
  const now = new Date();
  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - 30);
  const dateFrom = from.toISOString().replace(/\.\d{3}/, ".000");
  const dateTo = to.toISOString().replace(/\.\d{3}/, ".999");

  const { sales, orders } = await getSalesMap(accessToken, sellerId, itemIds, dateFrom, dateTo);
  return NextResponse.json({ sales, orders });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const itemIdsParam = url.searchParams.get("item_ids")?.trim() ?? "";
  const itemIds = [
    ...new Set(itemIdsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)),
  ];
  return handleSalesRequest(req, itemIds);
}

export async function POST(req: NextRequest) {
  let itemIds: string[] = [];
  try {
    const body = (await req.json()) as { item_ids?: string[] };
    itemIds = [
      ...new Set(
        (Array.isArray(body?.item_ids) ? body.item_ids : [])
          .map((s) => String(s).trim().toUpperCase())
          .filter(Boolean)
      ),
    ];
  } catch {
    // body inválido
  }
  return handleSalesRequest(req, itemIds);
}
