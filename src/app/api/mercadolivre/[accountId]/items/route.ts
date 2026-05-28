import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { fetchAllViaRange, isAllPageSize } from "@/lib/table-pagination";
import {
  CRITICAL_ML_ITEM_TAGS,
  CRITICAL_ML_ITEM_TAGS_LIST,
  type StockCompareOp,
  STOCK_COMPARE_OPS,
} from "@/lib/mercadolivre/item-tags";

const DEFAULT_PAGE_SIZE = 20;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyStockFilter(q: any, op: StockCompareOp, qty: number) {
  let next = q.not("available_quantity", "is", null);
  switch (op) {
    case "gt":
      next = next.gt("available_quantity", qty);
      break;
    case "lt":
      next = next.lt("available_quantity", qty);
      break;
    case "gte":
      next = next.gte("available_quantity", qty);
      break;
    case "lte":
      next = next.lte("available_quantity", qty);
      break;
    case "eq":
      next = next.eq("available_quantity", qty);
      break;
  }
  return next;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySoldFilter(q: any, op: StockCompareOp, qty: number) {
  let next = q.not("sold_quantity", "is", null);
  switch (op) {
    case "gt":
      next = next.gt("sold_quantity", qty);
      break;
    case "lt":
      next = next.lt("sold_quantity", qty);
      break;
    case "gte":
      next = next.gte("sold_quantity", qty);
      break;
    case "lte":
      next = next.lte("sold_quantity", qty);
      break;
    case "eq":
      next = next.eq("sold_quantity", qty);
      break;
  }
  return next;
}

/** Filtro de alertas via tags_text (array PostgreSQL) — compatível com PostgREST. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyMlAlertFilter(q: any, mlAlert: string) {
  const critical = [...CRITICAL_ML_ITEM_TAGS_LIST];

  if (mlAlert === "any") {
    return q.overlaps("tags_text", critical);
  }
  if (mlAlert === "none") {
    return q.not("tags_text", "ov", critical);
  }
  if (CRITICAL_ML_ITEM_TAGS.has(mlAlert)) {
    return q.contains("tags_text", [mlAlert]);
  }
  return q;
}

/** Alinhado às opções da tela Anúncios (10…1000). */
const MAX_PAGE_SIZE = 1000;
/** Modo família MLBU: range fixo no início da lista; limite menor por desenho da UI. */
const MAX_PAGE_SIZE_FAMILY = 100;

/**
 * GET /api/mercadolivre/{accountId}/items?search=&status=&listing_type_id=&full_only=&mlbu=&mlbu_code=
 *   &ml_alert=&stock_op=&stock_qty=&sold_op=&sold_qty=&page=&limit=
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
  const fullOnly = searchParams.get("full_only") === "1" || searchParams.get("full_only") === "true";
  const mlbuOnly = searchParams.get("mlbu") === "1" || searchParams.get("mlbu") === "true";
  const familyId = searchParams.get("family_id")?.trim() ?? "";
  const mlbuCode = searchParams.get("mlbu_code")?.trim() ?? "";
  const listingTypeId = searchParams.get("listing_type_id")?.trim() ?? "";
  const mlAlert = searchParams.get("ml_alert")?.trim() ?? "";
  const stockOpRaw = searchParams.get("stock_op")?.trim() ?? "";
  const stockOp = STOCK_COMPARE_OPS.includes(stockOpRaw as StockCompareOp)
    ? (stockOpRaw as StockCompareOp)
    : null;
  const stockQtyParsed = parseInt(searchParams.get("stock_qty")?.trim() ?? "", 10);
  const stockQty =
    stockOp != null && Number.isFinite(stockQtyParsed) && stockQtyParsed >= 0
      ? stockQtyParsed
      : null;
  const soldOpRaw = searchParams.get("sold_op")?.trim() ?? "";
  const soldOp = STOCK_COMPARE_OPS.includes(soldOpRaw as StockCompareOp)
    ? (soldOpRaw as StockCompareOp)
    : null;
  const soldQtyParsed = parseInt(searchParams.get("sold_qty")?.trim() ?? "", 10);
  const soldQty =
    soldOp != null && Number.isFinite(soldQtyParsed) && soldQtyParsed >= 0
      ? soldQtyParsed
      : null;
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
        "item_id, title, status, price, sale_price, available_quantity, sold_quantity, health, tags_json, has_variations, thumbnail, permalink, updated_at, user_product_id, family_id, family_name, listing_type_id, category_id",
        { count: "exact" }
      )
      .eq("account_id", accountId)
      .order("updated_at", { ascending: false });
    if (mlAlert) q = applyMlAlertFilter(q, mlAlert);
    if (search) {
      q = q.or(
        `title.ilike.%${search}%,item_id.ilike.%${search}%,family_name.ilike.%${search}%,user_product_id.ilike.%${search}%`
      );
    }
    if (statusFilter) q = q.eq("status", statusFilter);
    if (fullOnly) q = q.contains("tags_text", ["fulfillment"]);
    if (mlbuOnly) q = q.not("user_product_id", "is", null);
    if (familyId) q = q.eq("family_id", familyId);
    if (mlbuCode) q = q.ilike("user_product_id", `%${mlbuCode}%`);
    if (listingTypeId) q = q.eq("listing_type_id", listingTypeId);
    if (stockOp != null && stockQty != null) q = applyStockFilter(q, stockOp, stockQty);
    if (soldOp != null && soldQty != null) q = applySoldFilter(q, soldOp, soldQty);
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
      items: rows ?? [],
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
