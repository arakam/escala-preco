import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  fetchSellerPromotionCampaignItems,
  resolveMlAccountAccessToken,
} from "@/lib/mercadolivre/fetch-seller-campaigns";
import { normalizeMlPromotionTypeCode } from "@/lib/mercadolivre/ml-promotion-types";

/**
 * GET /api/mercadolivre/{accountId}/seller-promotions/campaigns/{promotionId}/items
 * Itens de uma campanha (seller-promotions/promotions/{id}/items).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string; promotionId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { accountId, promotionId } = await params;
  if (!accountId || !promotionId) {
    return NextResponse.json({ error: "Parâmetros obrigatórios ausentes" }, { status: 400 });
  }

  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const promotionType =
    normalizeMlPromotionTypeCode(searchParams.get("promotion_type")) ||
    searchParams.get("promotion_type")?.trim() ||
    "";
  if (!promotionType) {
    return NextResponse.json({ error: "promotion_type obrigatório" }, { status: 400 });
  }

  const statusRaw = searchParams.get("status")?.trim().toLowerCase() ?? "";
  const status =
    statusRaw === "candidate" || statusRaw === "started" || statusRaw === "pending"
      ? statusRaw
      : ("" as const);

  const itemId = searchParams.get("item_id")?.trim() ?? "";
  const searchAfter = searchParams.get("search_after")?.trim() ?? null;
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));

  const access = await resolveMlAccountAccessToken(supabase, accountId, user.id);
  if (!access) {
    return NextResponse.json({ error: "Token do Mercado Livre indisponível" }, { status: 401 });
  }

  const result = await fetchSellerPromotionCampaignItems({
    promotionId,
    promotionType,
    accessToken: access.accessToken,
    status,
    itemId: itemId || undefined,
    limit,
    searchAfter,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Erro ao listar itens da campanha no Mercado Livre", details: result.message },
      { status: result.status >= 400 && result.status < 600 ? result.status : 502 }
    );
  }

  return NextResponse.json({
    promotion_id: promotionId,
    promotion_type: promotionType,
    results: result.page.results,
    paging: result.page.paging,
  });
}
