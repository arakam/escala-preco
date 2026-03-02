import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const offset = (page - 1) * limit;
  const sortBy = searchParams.get("sortBy") || "total_listings";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? true : false;

  let query = supabase
    .from("product_listing_stats")
    .select("*", { count: "exact" })
    .eq("user_id", user.id);

  if (search) {
    query = query.or(`sku.ilike.%${search}%,title.ilike.%${search}%`);
  }

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
  query = query.order(sortColumn, { ascending: sortOrder });

  const { data: stats, error, count } = await query.range(offset, offset + limit - 1);

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
