import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  parseProductListFilters,
  resolveProductIdsForListFilters,
} from "@/lib/product-filters";
import { fetchProductStatsListPage } from "@/lib/products/fetch-product-stats-list";
import { isAllPageSize } from "@/lib/table-pagination";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const search = searchParams.get("search") || "";
  const listFilters = parseProductListFilters(searchParams);
  const limitParam = parseInt(searchParams.get("limit") || "50", 10);
  const showAll = isAllPageSize(limitParam);
  const page = showAll ? 1 : parseInt(searchParams.get("page") || "1", 10);
  const limit = showAll ? 0 : limitParam;
  const sortBy = searchParams.get("sortBy") || "total_listings";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? true : false;

  const validSortColumns = [
    "sku",
    "title",
    "total_items",
    "total_variations",
    "total_listings",
    "active_items",
    "min_item_price",
    "max_item_price",
    "total_available_qty",
    "total_sold_qty",
  ];

  const sortColumn = validSortColumns.includes(sortBy) ? sortBy : "total_listings";

  let productIdsFiltered: string[] | null = null;
  const needsListFilters =
    listFilters.tagIds.length > 0 || Boolean(listFilters.supplier) || listFilters.hasPma !== "";
  if (needsListFilters) {
    try {
      productIdsFiltered = await resolveProductIdsForListFilters(
        supabase,
        user.id,
        listFilters
      );
      if (productIdsFiltered?.length === 0) {
        return NextResponse.json({
          stats: [],
          total: 0,
          page,
          limit: showAll ? 0 : limit,
          totalPages: 0,
        });
      }
    } catch (e) {
      console.error("Erro ao filtrar estatísticas:", e);
      return NextResponse.json({ error: "Erro ao filtrar produtos" }, { status: 500 });
    }
  }

  const { rows, total, error } = await fetchProductStatsListPage(supabase, user.id, {
    search,
    productIds: productIdsFiltered,
    page,
    limit,
    showAll,
    sortColumn,
    sortAscending: sortOrder,
  });

  if (error) {
    console.error("Erro ao buscar estatísticas:", error);
    return NextResponse.json(
      { error: "Erro ao buscar estatísticas de produtos" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    stats: rows,
    total,
    page: showAll ? 1 : page,
    limit: showAll ? 0 : limit,
    totalPages: showAll ? 1 : Math.ceil(total / limit),
  });
}
