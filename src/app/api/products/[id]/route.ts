import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ProductInput } from "@/lib/db/types";

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

  return NextResponse.json({ product });
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

  /** Recalcula `pricing_cache` para cada MLB vinculado — Promoções/Preços usam peso/dimensões do cache, não leem `products` em tempo real. */
  try {
    const [{ data: linkedItems }, { data: linkedVars }] = await Promise.all([
      supabase.from("ml_items").select("account_id, item_id").eq("product_id", id),
      supabase.from("ml_variations").select("account_id, item_id").eq("product_id", id),
    ]);
    const seen = new Map<string, { account_id: string; item_id: string }>();
    for (const r of [...(linkedItems ?? []), ...(linkedVars ?? [])]) {
      const aid = r.account_id != null ? String(r.account_id) : "";
      const iid = r.item_id != null ? String(r.item_id).trim().toUpperCase() : "";
      if (!aid || !iid) continue;
      const key = `${aid}:${iid}`;
      if (!seen.has(key)) seen.set(key, { account_id: aid, item_id: iid });
    }
    if (seen.size > 0) {
      const { refreshPricingCacheByItemId } = await import("@/lib/pricing-cache");
      const pairs = Array.from(seen.values());
      for (const { account_id, item_id } of pairs) {
        await refreshPricingCacheByItemId(account_id, item_id);
      }
      const itemIdsList = Array.from(new Set(pairs.map((v) => v.item_id)));
      const { error: promoDelErr } = await supabase
        .from("promotions_cache_rows")
        .delete()
        .eq("user_id", user.id)
        .in("item_id", itemIdsList);
      if (promoDelErr) {
        console.error("[products/[id] PUT] limpar snapshot promoções:", promoDelErr);
      }
    }
  } catch (e) {
    console.error("[products/[id] PUT] refresh pricing_cache após atualizar produto:", e);
  }

  return NextResponse.json({ product });
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

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("Erro ao excluir produto:", error);
    return NextResponse.json({ error: "Erro ao excluir produto" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
