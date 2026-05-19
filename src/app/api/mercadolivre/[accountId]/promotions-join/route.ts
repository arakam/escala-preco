import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { runWithConcurrency } from "@/lib/mercadolivre/client";
import {
  buildSellerPromotionJoinBody,
  postSellerPromotionJoin,
  type JoinSellerPromotionInput,
  type JoinSellerPromotionItemResult,
} from "@/lib/mercadolivre/join-seller-promotion";
import { normalizeMlPromotionTypeCode } from "@/lib/mercadolivre/ml-promotion-types";
import { refreshPromotionsForItems } from "@/lib/mercadolivre/promotions-cache";

type JoinBody = {
  items?: JoinSellerPromotionInput[];
};

/**
 * POST /api/mercadolivre/{accountId}/promotions-join
 * Aceita convites / participa de promoções no ML (seller-promotions).
 */
export async function POST(
  req: NextRequest,
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

  let body: JoinBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return NextResponse.json({ error: "Envie pelo menos um item em items" }, { status: 400 });
  }
  if (rawItems.length > 100) {
    return NextResponse.json({ error: "Máximo de 100 itens por requisição" }, { status: 400 });
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id, user_id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Configuração do servidor incompleta (Supabase)" },
      { status: 500 }
    );
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

  const token = tokenData as {
    access_token: string;
    refresh_token: string;
    expires_at: string;
  };

  const accessToken = await getValidAccessToken(
    account.id,
    token.access_token,
    token.refresh_token,
    token.expires_at,
    adminSupabase
  );

  if (!accessToken) {
    return NextResponse.json({ error: "Token do Mercado Livre indisponível" }, { status: 401 });
  }

  const normalized: Array<{
    item_id: string;
    promotion_id: string;
    promotion_type: string;
    deal_price: number | null;
    offer_id: string | null;
  }> = [];

  for (const row of rawItems) {
    const item_id = String(row.item_id ?? "").trim();
    const promotion_id = String(row.promotion_id ?? "").trim();
    const promotion_type =
      normalizeMlPromotionTypeCode(row.promotion_type) ?? String(row.promotion_type ?? "").trim();
    if (!item_id || !promotion_id || !promotion_type) continue;
    const deal_price =
      row.deal_price != null && Number.isFinite(Number(row.deal_price))
        ? Number(row.deal_price)
        : null;
    const offer_id =
      row.offer_id != null && String(row.offer_id).trim() !== ""
        ? String(row.offer_id).trim()
        : null;
    normalized.push({ item_id, promotion_id, promotion_type, deal_price, offer_id });
  }

  if (normalized.length === 0) {
    return NextResponse.json(
      { error: "Nenhum item válido (item_id, promotion_id e promotion_type obrigatórios)" },
      { status: 400 }
    );
  }

  const results = await runWithConcurrency(
    normalized,
    5,
    async (item): Promise<JoinSellerPromotionItemResult> => {
      const built = buildSellerPromotionJoinBody(
        item.promotion_id,
        item.promotion_type,
        item.deal_price,
        item.offer_id
      );
      if (!built.ok) {
        return {
          item_id: item.item_id,
          promotion_id: item.promotion_id,
          status: "error",
          error: built.error,
        };
      }

      const posted = await postSellerPromotionJoin(item.item_id, accessToken, built.body);
      if (posted.ok) {
        return {
          item_id: item.item_id,
          promotion_id: item.promotion_id,
          status: "ok",
        };
      }
      return {
        item_id: item.item_id,
        promotion_id: item.promotion_id,
        status: "error",
        error: posted.message,
      };
    }
  );

  const okCount = results.filter((r) => r.status === "ok").length;
  const errorCount = results.filter((r) => r.status === "error").length;

  const okItemIds = Array.from(
    new Set(
      results
        .filter((r) => r.status === "ok")
        .map((r) => String(r.item_id).trim().toUpperCase())
        .filter(Boolean)
    )
  );
  if (okItemIds.length > 0) {
    try {
      await refreshPromotionsForItems({
        supabase: adminSupabase,
        accountId: account.id,
        userId: user.id,
        itemIds: okItemIds,
      });
    } catch (e) {
      console.warn("[promotions-join] refresh cache após join:", e);
    }
  }

  return NextResponse.json({
    summary: {
      requested: normalized.length,
      ok: okCount,
      errors: errorCount,
    },
    results,
  });
}
