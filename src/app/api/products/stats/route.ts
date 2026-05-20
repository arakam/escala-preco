import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveProductIdsByTagIds } from "@/lib/product-tags";
import { fetchAllViaRange, isAllPageSize } from "@/lib/table-pagination";

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
  const tagIdsParam = searchParams.get("tags")?.trim() || "";
  const tagIds = tagIdsParam
    ? tagIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const limitParam = parseInt(searchParams.get("limit") || "50", 10);
  const showAll = isAllPageSize(limitParam);
  const page = showAll ? 1 : parseInt(searchParams.get("page") || "1", 10);
  const limit = showAll ? 0 : limitParam;
  const offset = (page - 1) * limit;
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

  let productIdsForTags: string[] | null = null;
  if (tagIds.length > 0) {
    try {
      productIdsForTags = await resolveProductIdsByTagIds(supabase, tagIds);
      if (productIdsForTags.length === 0) {
        return NextResponse.json({
          stats: [],
          total: 0,
          page,
          limit: showAll ? 0 : limit,
          totalPages: 0,
        });
      }
    } catch (e) {
      console.error("Erro ao filtrar estatísticas por tags:", e);
      return NextResponse.json({ error: "Erro ao filtrar por tags" }, { status: 500 });
    }
  }

  const buildBaseQuery = () => {
    let q = supabase
      .from("product_listing_stats")
      .select("*", { count: "exact" })
      .eq("user_id", user.id);
    if (search) {
      q = q.or(`sku.ilike.%${search}%,title.ilike.%${search}%`);
    }
    if (productIdsForTags) {
      q = q.in("product_id", productIdsForTags);
    }
    return q.order(sortColumn, { ascending: sortOrder });
  };

  if (showAll) {
    const { rows, total, error } = await fetchAllViaRange((from, to) =>
      buildBaseQuery().range(from, to)
    );
    if (error) {
      console.error("Erro ao buscar estatísticas:", error);
      return NextResponse.json(
        { error: "Erro ao buscar estatísticas" },
        { status: 500 }
      );
    }
    return NextResponse.json({
      stats: rows,
      total,
      page: 1,
      limit: 0,
      totalPages: 1,
    });
  }

  const { data: stats, error, count } = await buildBaseQuery().range(
    offset,
    offset + limit - 1
  );

  if (error) {
    console.error("Erro ao buscar estatísticas:", error);
    return NextResponse.json(
      { error: "Erro ao buscar estatísticas de produtos" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    stats: stats ?? [],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.ceil((count ?? 0) / limit),
  });
}
