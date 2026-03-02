import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ProductInput } from "@/lib/db/types";

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
    .from("products")
    .select("*", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (search) {
    query = query.or(
      `sku.ilike.%${search}%,title.ilike.%${search}%,ean.ilike.%${search}%`
    );
  }

  const { data: products, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    console.error("Erro ao buscar produtos:", error);
    return NextResponse.json({ error: "Erro ao buscar produtos" }, { status: 500 });
  }

  return NextResponse.json({
    products: products ?? [],
    total: count ?? 0,
    page,
    limit,
    totalPages: Math.ceil((count ?? 0) / limit),
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: ProductInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body.sku) {
    return NextResponse.json(
      { error: "SKU é obrigatório" },
      { status: 400 }
    );
  }

  const { data: product, error } = await supabase
    .from("products")
    .insert({
      user_id: user.id,
      sku: body.sku.trim(),
      title: body.title?.trim() || body.sku.trim(),
      description: body.description?.trim() || null,
      ean: body.ean?.trim() || null,
      height: body.height ?? null,
      width: body.width ?? null,
      length: body.length ?? null,
      weight: body.weight ?? null,
      cost_price: body.cost_price ?? null,
      sale_price: body.sale_price ?? null,
      tax_percent: body.tax_percent ?? null,
      extra_fee_percent: body.extra_fee_percent ?? null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Já existe um produto com este SKU" },
        { status: 409 }
      );
    }
    console.error("Erro ao criar produto:", error);
    return NextResponse.json({ error: "Erro ao criar produto" }, { status: 500 });
  }

  return NextResponse.json({ product }, { status: 201 });
}
