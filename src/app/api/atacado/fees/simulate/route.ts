import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { fetchSaleFee } from "@/lib/mercadolivre/fees";
import { NextRequest, NextResponse } from "next/server";

export interface FeesSimulateBody {
  accountId: string;
  item_id: string;
  variation_id?: number | null;
  listing_type_id: string;
  category_id?: string;
  prices: number[];
}

export interface FeesSimulateResult {
  ok: boolean;
  results?: { price: number; fee: number; net: number }[];
  error?: string;
}

/**
 * POST /api/atacado/fees/simulate
 * Simula taxa ML por preço unitário. Retorna fee e net (preço - taxa) para cada price.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  let body: FeesSimulateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const accountId = body.accountId?.trim();
  const itemId = body.item_id?.trim();
  const listingTypeId = body.listing_type_id?.trim();
  const prices = Array.isArray(body.prices) ? body.prices.filter((p) => typeof p === "number" && p > 0) : [];

  if (!accountId || !itemId || !listingTypeId) {
    return NextResponse.json(
      { ok: false, error: "accountId, item_id e listing_type_id são obrigatórios" },
      { status: 400 }
    );
  }

  if (prices.length === 0) {
    return NextResponse.json({ ok: true, results: [] });
  }

  if (prices.length > 20) {
    return NextResponse.json(
      { ok: false, error: "Máximo 20 preços por requisição" },
      { status: 400 }
    );
  }

  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id, site_id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();

  if (!account) {
    return NextResponse.json({ ok: false, error: "Conta não encontrada" }, { status: 404 });
  }

  const siteId = (account as { site_id?: string | null }).site_id ?? "MLB";

  const serviceSupabase = createServiceClient();
  const { data: tokenRow } = await serviceSupabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", accountId)
    .single();

  const token = tokenRow as { access_token: string; refresh_token: string; expires_at: string } | null;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Token da conta não encontrado. Reconecte a conta no Mercado Livre." },
      { status: 400 }
    );
  }

  const accessToken = await getValidAccessToken(
    accountId,
    token.access_token,
    token.refresh_token,
    token.expires_at,
    serviceSupabase
  );
  if (!accessToken) {
    return NextResponse.json(
      { ok: false, error: "Não foi possível obter acesso ao Mercado Livre. Tente reconectar a conta." },
      { status: 400 }
    );
  }

  const results: { price: number; fee: number; net: number }[] = [];
  for (const price of prices) {
    const feeResult = await fetchSaleFee(accessToken, siteId, listingTypeId, price);
    if (feeResult == null) {
      return NextResponse.json(
        {
          ok: false,
          error: `Não foi possível obter a taxa para o preço R$ ${price.toFixed(2)}. Verifique o tipo de anúncio ou tente novamente.`,
        },
        { status: 502 }
      );
    }
    results.push({
      price,
      fee: feeResult.fee,
      net: Math.round((price - feeResult.fee) * 100) / 100,
    });
  }

  return NextResponse.json({ ok: true, results });
}
