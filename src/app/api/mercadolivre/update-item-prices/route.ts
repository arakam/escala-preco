import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { runWithConcurrency } from "@/lib/mercadolivre/client";
import { updateItemPriceOnMl } from "@/lib/mercadolivre/update-item-price";
import { syncSingleItem } from "@/lib/mercadolivre/sync-worker";
import { refreshPricingCacheByItemId } from "@/lib/pricing-cache";
import { applyPriceRounding } from "@/lib/pricing/price-rounding";
import { loadPriceRoundingForUser } from "@/lib/pricing/load-price-rounding";

type UpdateItemPriceInput = {
  item_id: string;
  variation_id?: number | null;
  promotion_price: number;
};

type ItemApplyResult =
  | { item_id: string; variation_id: number | null; status: "ok"; price: number; warnings?: string[] }
  | { item_id: string; variation_id: number | null; status: "skipped_invalid_price" }
  | { item_id: string; variation_id: number | null; status: "error"; error: string };

/**
 * POST /api/mercadolivre/update-item-prices
 * Body: { items: [{ item_id, variation_id?, promotion_price }] }
 * Envia o preço da coluna Preço Calculado para o Mercado Livre (PUT /items/{id}).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: { items?: UpdateItemPriceInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "Envie pelo menos um item em items" }, { status: 400 });
  }

  const normalized = items
    .map((i) => ({
      item_id: (i.item_id || "").trim().toUpperCase(),
      variation_id: i.variation_id == null ? null : Number(i.variation_id),
      promotion_price: Number(i.promotion_price),
    }))
    .filter((i) => i.item_id);

  if (normalized.length === 0) {
    return NextResponse.json({ error: "Nenhum item válido (item_id obrigatório)" }, { status: 400 });
  }

  const byItemId = new Map<string, (typeof normalized)[number]>();
  const duplicateErrors: ItemApplyResult[] = [];
  for (const row of normalized) {
    if (byItemId.has(row.item_id)) {
      duplicateErrors.push({
        item_id: row.item_id,
        variation_id: row.variation_id,
        status: "error",
        error: "MLB duplicado na seleção (envie uma linha por anúncio)",
      });
      continue;
    }
    byItemId.set(row.item_id, row);
  }

  const uniqueItems = Array.from(byItemId.values());

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Configuração do servidor incompleta (Supabase)" }, { status: 500 });
  }

  const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);
  const { data: tokenData, error: tokenError } = await adminSupabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", account.id)
    .single();

  if (tokenError || !tokenData) {
    return NextResponse.json({ error: "Token do Mercado Livre não encontrado" }, { status: 404 });
  }

  const token = tokenData as { access_token: string; refresh_token: string; expires_at: string };
  const accessToken = await getValidAccessToken(
    account.id,
    token.access_token,
    token.refresh_token,
    token.expires_at,
    adminSupabase
  );

  if (!accessToken) {
    return NextResponse.json({ error: "Falha ao obter access_token válido do Mercado Livre" }, { status: 401 });
  }

  // Arredondamento do Preço Final (preferência do usuário): aplicado ao preço enviado ao ML.
  const priceRounding = await loadPriceRoundingForUser(supabase, user.id);

  const applyResults = await runWithConcurrency(uniqueItems, 3, async (item): Promise<ItemApplyResult> => {
    if (!Number.isFinite(item.promotion_price) || item.promotion_price <= 0) {
      return {
        item_id: item.item_id,
        variation_id: item.variation_id,
        status: "skipped_invalid_price",
      };
    }

    const finalPrice = applyPriceRounding(item.promotion_price, priceRounding);

    const updated = await updateItemPriceOnMl(
      item.item_id,
      accessToken,
      finalPrice,
      item.variation_id
    );

    if (!updated.ok) {
      return {
        item_id: item.item_id,
        variation_id: item.variation_id,
        status: "error",
        error: updated.error,
      };
    }

    try {
      await syncSingleItem(account.id, item.item_id);
      await refreshPricingCacheByItemId(account.id, item.item_id);
    } catch (e) {
      console.error("[update-item-prices] sync/cache após preço:", item.item_id, e);
    }

    return {
      item_id: item.item_id,
      variation_id: item.variation_id,
      status: "ok",
      price: updated.price,
      warnings: updated.warnings.length > 0 ? updated.warnings : undefined,
    };
  });

  const results = [...duplicateErrors, ...applyResults];
  const okCount = results.filter((r) => r.status === "ok").length;
  const skippedCount = results.filter((r) => r.status === "skipped_invalid_price").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  return NextResponse.json({
    summary: {
      requested_items: normalized.length,
      applied: okCount,
      skipped_invalid_price: skippedCount,
      errors: errorCount,
    },
    items: results,
  });
}
