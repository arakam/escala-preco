import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const PAGE_SIZE = 20;

/**
 * GET /api/mercadolivre/{accountId}/items?search=&page=
 * Lista itens sincronizados do banco para a conta (do usuário logado).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { accountId } = await params;
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

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";
  const statusFilter = searchParams.get("status")?.trim() ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from("ml_items")
    .select("item_id, title, status, price, has_variations, thumbnail, permalink, updated_at, wholesale_prices_json", { count: "exact" })
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(`title.ilike.%${search}%,item_id.ilike.%${search}%`);
  }
  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data: items, error, count } = await query;
  if (error) {
    console.error("[items list]", error);
    return NextResponse.json({ error: "Erro ao listar itens" }, { status: 500 });
  }

  return NextResponse.json({
    items: items ?? [],
    total: count ?? 0,
    page,
    page_size: PAGE_SIZE,
  });
}
