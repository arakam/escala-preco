import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ProductInput } from "@/lib/db/types";
import {
  fetchTagsGroupedByProductId,
  resolveProductIdsByTagIds,
  setProductTagsByNames,
} from "@/lib/product-tags";
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

  let productIdsForTags: string[] | null = null;
  if (tagIds.length > 0) {
    try {
      productIdsForTags = await resolveProductIdsByTagIds(supabase, tagIds);
      if (productIdsForTags.length === 0) {
        return NextResponse.json({
          products: [],
          total: 0,
          page,
          limit: showAll ? 0 : limit,
          totalPages: 0,
        });
      }
    } catch (e) {
      console.error("Erro ao filtrar por tags:", e);
      return NextResponse.json({ error: "Erro ao filtrar por tags" }, { status: 500 });
    }
  }

  const buildBaseQuery = () => {
    let q = supabase
      .from("products")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (search) {
      q = q.or(
        `sku.ilike.%${search}%,title.ilike.%${search}%,ean.ilike.%${search}%`
      );
    }
    if (productIdsForTags) {
      q = q.in("id", productIdsForTags);
    }
    return q;
  };

  const attachTags = async (rows: { id: string }[]) => {
    const tagMap = await fetchTagsGroupedByProductId(
      supabase,
      rows.map((r) => r.id)
    );
    return rows.map((r) => ({
      ...r,
      tags: tagMap.get(r.id) ?? [],
    }));
  };

  if (showAll) {
    const { rows, total, error } = await fetchAllViaRange((from, to) =>
      buildBaseQuery().range(from, to)
    );
    if (error) {
      console.error("Erro ao buscar produtos:", error);
      return NextResponse.json({ error: "Erro ao buscar produtos" }, { status: 500 });
    }
    const withTags = await attachTags(rows);
    return NextResponse.json({
      products: withTags,
      total,
      page: 1,
      limit: 0,
      totalPages: 1,
    });
  }

  const { data: products, error, count } = await buildBaseQuery().range(
    offset,
    offset + limit - 1
  );

  if (error) {
    console.error("Erro ao buscar produtos:", error);
    return NextResponse.json({ error: "Erro ao buscar produtos" }, { status: 500 });
  }

  const withTags = await attachTags(products ?? []);

  return NextResponse.json({
    products: withTags,
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
      fixed_expenses: body.fixed_expenses ?? null,
      pma: body.pma ?? null,
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

  if (body.tag_names && body.tag_names.length > 0 && product) {
    try {
      await setProductTagsByNames(supabase, user.id, product.id, body.tag_names);
      const tagMap = await fetchTagsGroupedByProductId(supabase, [product.id]);
      return NextResponse.json(
        { product: { ...product, tags: tagMap.get(product.id) ?? [] } },
        { status: 201 }
      );
    } catch (e) {
      console.error("Erro ao vincular tags ao produto:", e);
    }
  }

  return NextResponse.json({ product }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("user_id", user.id);

  if (error) {
    console.error("Erro ao excluir todos os produtos:", error);
    return NextResponse.json(
      { error: "Erro ao excluir todos os produtos" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
