import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/pricing/planned-prices
 * Retorna os preços planejados da conta (vinculados a MLB e SKU).
 * Query opcional: item_ids=MLB1,MLB2 para filtrar.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const url = new URL(req.url);
  const itemIdsParam = url.searchParams.get("item_ids")?.trim();
  const itemIds = itemIdsParam ? itemIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : null;

  let query = supabase
    .from("planned_prices")
    .select("item_id, variation_id, sku, planned_price, updated_at")
    .eq("account_id", account.id);

  if (itemIds && itemIds.length > 0) {
    query = query.in("item_id", itemIds);
  }

  const { data: rows, error } = await query.order("updated_at", { ascending: false });

  if (error) {
    console.error("[planned-prices GET]", error);
    return NextResponse.json({ error: "Erro ao carregar preços salvos" }, { status: 500 });
  }

  const prices = (rows ?? []).map((r) => ({
    item_id: r.item_id,
    variation_id: r.variation_id == null || r.variation_id === -1 ? null : r.variation_id,
    sku: r.sku ?? null,
    planned_price: Number(r.planned_price),
    updated_at: r.updated_at,
  }));

  return NextResponse.json({ prices });
}

type PlannedPriceInput = {
  item_id: string;
  variation_id: number | null;
  sku?: string | null;
  planned_price: number;
};

/**
 * POST /api/pricing/planned-prices
 * Body: { items: [{ item_id, variation_id?, sku?, planned_price }] }
 * Faz upsert dos preços planejados (vinculados a MLB e SKU).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  let body: { items?: PlannedPriceInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Envie pelo menos um item em items" }, { status: 400 });
  }

  const toUpsert = items
    .filter(
      (i) =>
        typeof i.item_id === "string" &&
        i.item_id.trim() !== "" &&
        typeof i.planned_price === "number" &&
        !Number.isNaN(i.planned_price) &&
        i.planned_price >= 0
    )
    .map((i) => ({
      account_id: account.id,
      item_id: i.item_id.trim().toUpperCase(),
      variation_id: i.variation_id == null ? -1 : Number(i.variation_id),
      sku: typeof i.sku === "string" ? i.sku.trim() || null : null,
      planned_price: Math.round(Number(i.planned_price) * 100) / 100,
      updated_at: new Date().toISOString(),
    }));

  if (toUpsert.length === 0) {
    return NextResponse.json({ error: "Nenhum item válido (item_id e planned_price obrigatórios)" }, { status: 400 });
  }

  const { error: upsertError } = await supabase.from("planned_prices").upsert(toUpsert, {
    onConflict: "account_id,item_id,variation_id",
    ignoreDuplicates: false,
  });

  if (upsertError) {
    const conflictHint = upsertError.code === "23505" ? " (conflito único: account_id, item_id, variation_id)" : "";
    console.error("[planned-prices POST]", upsertError);
    return NextResponse.json(
      { error: "Erro ao salvar preços" + conflictHint },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, saved: toUpsert.length });
}
