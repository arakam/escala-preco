import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  fetchSellerPromotionsForUser,
  resolveMlAccountAccessToken,
} from "@/lib/mercadolivre/fetch-seller-campaigns";

/**
 * GET /api/mercadolivre/{accountId}/seller-promotions/campaigns
 * Lista campanhas/promoções do vendedor no ML (seller-promotions/users).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { accountId } = await params;
  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
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
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));

  const access = await resolveMlAccountAccessToken(supabase, accountId, user.id);
  if (!access) {
    return NextResponse.json({ error: "Token do Mercado Livre indisponível" }, { status: 401 });
  }

  const result = await fetchSellerPromotionsForUser(access.mlUserId, access.accessToken, {
    offset,
    limit,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Erro ao listar campanhas no Mercado Livre", details: result.message },
      { status: result.status >= 400 && result.status < 600 ? result.status : 502 }
    );
  }

  return NextResponse.json({
    campaigns: result.campaigns,
    paging: result.paging,
  });
}
