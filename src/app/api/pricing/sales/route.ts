import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { getSalesMap } from "@/lib/mercadolivre/sales";

const MAX_ITEMS = 500;

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
  const itemIds = Array.from(
    new Set(itemIdsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))
  );
  return handleSalesRequest(req, itemIds);
}

export async function POST(req: NextRequest) {
  let itemIds: string[] = [];
  try {
    const body = (await req.json()) as { item_ids?: string[] };
    itemIds = Array.from(
      new Set(
        (Array.isArray(body?.item_ids) ? body.item_ids : [])
          .map((s) => String(s).trim().toUpperCase())
          .filter(Boolean)
      )
    );
  } catch {
    // body inválido
  }
  return handleSalesRequest(req, itemIds);
}
