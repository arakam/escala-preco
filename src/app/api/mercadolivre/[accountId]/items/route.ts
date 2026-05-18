import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { fetchAllViaRange, isAllPageSize } from "@/lib/table-pagination";

const DEFAULT_PAGE_SIZE = 20;
/** Alinhado às opções da tela Anúncios (10…1000). */
const MAX_PAGE_SIZE = 1000;
/** Modo família MLBU: range fixo no início da lista; limite menor por desenho da UI. */
const MAX_PAGE_SIZE_FAMILY = 100;

/**
 * GET /api/mercadolivre/{accountId}/items?search=&status=&listing_type_id=&mlbu=&mlbu_code=&page=&limit=
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
  const listingTypeId = searchParams.get("listing_type_id")?.trim() ?? "";
  const limitParam = searchParams.get("limit");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const parsedLimit = limitParam != null && limitParam !== "" ? parseInt(limitParam, 10) : NaN;
  const showAll = !familyId && isAllPageSize(parsedLimit);
  const pageSize = familyId
    ? Math.min(
        MAX_PAGE_SIZE_FAMILY,
        Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : MAX_PAGE_SIZE_FAMILY)
      )
    : showAll
      ? 0
      : Math.min(
          MAX_PAGE_SIZE,
          Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : DEFAULT_PAGE_SIZE)
        );
  const from = familyId ? 0 : showAll ? 0 : (page - 1) * pageSize;
  const to = from + (showAll ? 0 : pageSize - 1);

  const buildBaseQuery = () => {
    let q = supabase
      .from("ml_items")
      .select(
        "item_id, title, status, price, has_variations, thumbnail, permalink, updated_at, wholesale_prices_json, user_product_id, family_id, family_name, listing_type_id, category_id",
        { count: "exact" }
      )
      .eq("account_id", accountId)
      .order("updated_at", { ascending: false });
    if (search) {
      q = q.or(
        `title.ilike.%${search}%,item_id.ilike.%${search}%,family_name.ilike.%${search}%,user_product_id.ilike.%${search}%`
      );
    }
    if (statusFilter) q = q.eq("status", statusFilter);
    if (mlbuOnly) q = q.not("user_product_id", "is", null);
    if (familyId) q = q.eq("family_id", familyId);
    if (mlbuCode) q = q.ilike("user_product_id", `%${mlbuCode}%`);
    if (listingTypeId) q = q.eq("listing_type_id", listingTypeId);
    return q;
  };

  if (showAll) {
    const { rows, total, error } = await fetchAllViaRange((rangeFrom, rangeTo) =>
      buildBaseQuery().range(rangeFrom, rangeTo)
    );
    if (error) {
      console.error("[items list]", error);
      return NextResponse.json({ error: "Erro ao listar itens" }, { status: 500 });
    }
    return NextResponse.json({
      items: rows,
      total,
      page: 1,
      page_size: 0,
    });
  }

  const { data: items, error, count } = await buildBaseQuery().range(from, to);
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
