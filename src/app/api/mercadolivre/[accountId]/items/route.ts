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
  const mlbuOnly = searchParams.get("mlbu") === "1" || searchParams.get("mlbu") === "true";
  const familyId = searchParams.get("family_id")?.trim() ?? "";
  const mlbuCode = searchParams.get("mlbu_code")?.trim() ?? "";
  const limitParam = searchParams.get("limit");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = familyId
    ? Math.min(100, Math.max(1, parseInt(limitParam ?? "100", 10) || 100))
    : PAGE_SIZE;
  const from = familyId ? 0 : (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("ml_items")
    .select("item_id, title, status, price, has_variations, thumbnail, permalink, updated_at, wholesale_prices_json, user_product_id, family_id, family_name", { count: "exact" })
    .eq("account_id", accountId)
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(`title.ilike.%${search}%,item_id.ilike.%${search}%,family_name.ilike.%${search}%,user_product_id.ilike.%${search}%`);
  }
  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }
  if (mlbuOnly) {
    query = query.not("user_product_id", "is", null);
  }
  if (familyId) {
    query = query.eq("family_id", familyId);
  }
  if (mlbuCode) {
    query = query.ilike("user_product_id", `%${mlbuCode}%`);
  }

  const { data: items, error, count } = await query;
  if (error) {
    console.error("[items list]", error);
    return NextResponse.json({ error: "Erro ao listar itens" }, { status: 500 });
  }

  return NextResponse.json({
    items: items ?? [],
    total: count ?? 0,
    page: familyId ? 1 : page,
    page_size: pageSize,
  });
}
