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

  let query = supabase
    .from("unlinked_ml_listings")
    .select("*", { count: "exact" })
    .eq("user_id", user.id);

  if (search) {
    query = query.or(`sku.ilike.%${search}%,title.ilike.%${search}%`);
  }

  query = query.order("sku", { ascending: true });

  const { data: listings, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    console.error("Erro ao buscar anúncios não vinculados:", error);
    return NextResponse.json(
      { error: "Erro ao buscar anúncios não vinculados" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    listings: listings ?? [],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.ceil((count ?? 0) / limit),
  });
}
