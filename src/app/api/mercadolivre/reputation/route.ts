import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";

interface SellerReputation {
  level_id: string | null;
  power_seller_status: string | null;
  real_level?: string;
  protection_end_date?: string;
  transactions: {
    canceled: number;
    completed: number;
    period: string;
    ratings: {
      negative: number;
      neutral: number;
      positive: number;
    };
    total: number;
  };
  metrics: {
    sales: {
      period: string;
      completed: number;
    };
    claims: {
      period: string;
      rate: number;
      value: number;
      excluded?: {
        real_value: number;
        real_rate: number;
      };
    };
    delayed_handling_time: {
      period: string;
      rate: number;
      value: number;
      excluded?: {
        real_value: number;
        real_rate: number;
      };
    };
    cancellations: {
      period: string;
      rate: number;
      value: number;
      excluded?: {
        real_value: number;
        real_rate: number;
      };
    };
  };
}

interface MLUserResponse {
  id: number;
  nickname: string;
  seller_reputation: SellerReputation;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id, ml_user_id, ml_nickname")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Configuração do servidor incompleta" }, { status: 500 });
  }

  const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);

  const { data: tokenData, error: tokenError } = await adminSupabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", account.id)
    .single();

  if (tokenError || !tokenData) {
    return NextResponse.json({ error: "Token não encontrado" }, { status: 404 });
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
    return NextResponse.json({ error: "Falha ao obter token válido" }, { status: 401 });
  }

  try {
    const res = await fetch(`https://api.mercadolibre.com/users/${account.ml_user_id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[ML reputation] API error:", res.status, errBody);
      return NextResponse.json({ error: "Erro ao buscar reputação" }, { status: res.status });
    }

    const data = (await res.json()) as MLUserResponse;

    return NextResponse.json({
      user_id: data.id,
      nickname: data.nickname,
      reputation: data.seller_reputation,
    });
  } catch (e) {
    console.error("[ML reputation] fetch error:", e);
    return NextResponse.json({ error: "Erro de rede" }, { status: 500 });
  }
}
