import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ProductInput } from "@/lib/db/types";
import {
  fetchTagsGroupedByProductId,
  setProductTagsByNames,
} from "@/lib/product-tags";
import {
  refreshPricingCacheForMlItems,
  refreshPricingCacheForProductIds,
} from "@/lib/products/refresh-pricing-after-product-change";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !product) {
    return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  }

  try {
    const tagMap = await fetchTagsGroupedByProductId(supabase, [id]);
    return NextResponse.json({ product: { ...product, tags: tagMap.get(id) ?? [] } });
  } catch {
    return NextResponse.json({ product });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
    .update({
      sku: body.sku.trim(),
      title: body.title?.trim() || body.sku.trim(),
      description: body.description?.trim() || null,
      supplier: body.supplier?.trim() || null,
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
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Já existe um produto com este SKU" },
        { status: 409 }
      );
    }
    console.error("Erro ao atualizar produto:", error);
    return NextResponse.json({ error: "Erro ao atualizar produto" }, { status: 500 });
  }

  if (!product) {
    return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  }

  if (body.tag_names !== undefined) {
    try {
      await setProductTagsByNames(supabase, user.id, id, body.tag_names);
    } catch (e) {
      console.error("Erro ao atualizar tags do produto:", e);
      return NextResponse.json({ error: "Erro ao atualizar tags" }, { status: 500 });
    }
  }

  try {
    const { errors } = await refreshPricingCacheForProductIds(supabase, user.id, [id]);
    if (errors.length > 0) {
      console.warn("[products/[id] PUT] pricing_cache:", errors.slice(0, 5));
    }
  } catch (e) {
    console.error("[products/[id] PUT] refresh pricing_cache após atualizar produto:", e);
  }

  try {
    const tagMap = await fetchTagsGroupedByProductId(supabase, [id]);
    return NextResponse.json({ product: { ...product, tags: tagMap.get(id) ?? [] } });
  } catch {
    return NextResponse.json({ product });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let mlRefsToRefresh: { account_id: string; item_id: string }[] = [];
  try {
    const [{ data: linkedItems }, { data: linkedVars }] = await Promise.all([
      supabase.from("ml_items").select("account_id, item_id").eq("product_id", id),
      supabase.from("ml_variations").select("account_id, item_id").eq("product_id", id),
    ]);
    const seen = new Map<string, { account_id: string; item_id: string }>();
    for (const r of [...(linkedItems ?? []), ...(linkedVars ?? [])]) {
      const account_id = r.account_id != null ? String(r.account_id) : "";
      const item_id = r.item_id != null ? String(r.item_id).trim().toUpperCase() : "";
      if (!account_id || !item_id) continue;
      seen.set(`${account_id}:${item_id}`, { account_id, item_id });
    }
    mlRefsToRefresh = Array.from(seen.values());
  } catch (e) {
    console.error("[products/[id] DELETE] listar MLBs vinculados:", e);
  }

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Erro ao excluir produto:", error);
    return NextResponse.json({ error: "Erro ao excluir produto" }, { status: 500 });
  }

  try {
    if (mlRefsToRefresh.length > 0) {
      const { errors } = await refreshPricingCacheForMlItems(mlRefsToRefresh);
      if (errors.length > 0) {
        console.warn("[products/[id] DELETE] pricing_cache:", errors.slice(0, 5));
      }
    }
  } catch (e) {
    console.error("[products/[id] DELETE] refresh pricing_cache:", e);
  }

  return NextResponse.json({ success: true });
}
