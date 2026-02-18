import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const ML_ME_URL = "https://api.mercadolibre.com/users/me";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  function failRedirect(message: string, reason?: string) {
    const params = new URLSearchParams({ error: "oauth_failed", message });
    if (reason) params.set("reason", reason);
    return NextResponse.redirect(`${appUrl}/app/configuracao?${params.toString()}`);
  }

  if (errorParam) {
    const desc = searchParams.get("error_description") || errorParam;
    console.error("[ML callback] OAuth error:", errorParam, desc);
    return failRedirect(desc);
  }

  if (!code || !state) {
    console.error("[ML callback] code ou state ausentes");
    return failRedirect("Resposta do Mercado Livre sem code ou state. Tente conectar de novo.", "no_code_state");
  }

  const cookieState = request.cookies.get("ml_oauth_state")?.value;
  const codeVerifier = request.cookies.get("ml_oauth_code_verifier")?.value;
  if (!cookieState) {
    console.error("[ML callback] cookie state ausente");
    return failRedirect(
      "Sessão expirada ou cookie bloqueado. Conecte novamente (não feche a aba antes de autorizar).",
      "cookie_missing"
    );
  }
  if (!codeVerifier) {
    console.error("[ML callback] code_verifier (PKCE) ausente");
    return failRedirect(
      "Sessão PKCE expirada. O Mercado Livre exige PKCE; conecte novamente (não feche a aba antes de autorizar).",
      "cookie_missing"
    );
  }
  const expectedState = createHash("sha256").update(cookieState).digest("hex");
  if (state !== expectedState) {
    console.error("[ML callback] state inválido");
    return failRedirect("Segurança: state inválido. Tente conectar novamente.", "state_invalid");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${appUrl}/auth/login?redirect=/app/configuracao`);
  }

  const clientId = process.env.MERCADOLIVRE_CLIENT_ID;
  const clientSecret = process.env.MERCADOLIVRE_CLIENT_SECRET;
  const redirectUri = process.env.MERCADOLIVRE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[ML callback] env vars ausentes");
    return failRedirect("Configuração do servidor incompleta (Client ID/Secret/Redirect URI).", "env_missing");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetch(ML_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
  } catch (e) {
    console.error("[ML callback] fetch token error:", e);
    return failRedirect("Erro de rede ao trocar o código. Tente novamente.", "network");
  }

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error("[ML callback] token response not ok:", tokenRes.status, errBody);
    let msg = "Falha ao obter token do Mercado Livre.";
    let reason = "token_exchange";
    try {
      const j = JSON.parse(errBody) as { message?: string; error_description?: string };
      if (j.message) msg = j.message;
      else if (j.error_description) msg = j.error_description;
    } catch {
      if (tokenRes.status === 400) {
        msg = "Redirect URI não confere com a cadastrada no app do Mercado Livre, ou código já usado. Verifique a URL de redirecionamento no painel do ML.";
        reason = "redirect_uri_or_code";
      } else if (tokenRes.status === 401) msg = "Client ID ou Secret incorretos. Verifique o .env.";
    }
    return failRedirect(msg, reason);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user_id: number;
  };

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  let meRes: Response;
  try {
    meRes = await fetch(ML_ME_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
  } catch (e) {
    console.error("[ML callback] fetch me error:", e);
    return failRedirect("Erro ao buscar dados da conta no Mercado Livre.", "network");
  }

  if (!meRes.ok) {
    console.error("[ML callback] me response not ok:", meRes.status);
    return failRedirect("Não foi possível obter seus dados do Mercado Livre. Tente de novo.", "me_failed");
  }

  const meData = (await meRes.json()) as { id: number; nickname: string; site_id?: string };
  const mlUserId = meData.id;
  const mlNickname = meData.nickname ?? null;
  const siteId = meData.site_id ?? null;

  const { data: existing } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("ml_user_id", mlUserId)
    .maybeSingle();

  let accountId: string;
  if (existing) {
    accountId = existing.id;
    await supabase
      .from("ml_accounts")
      .update({ ml_nickname: mlNickname, site_id: siteId })
      .eq("id", accountId);
    const { error: tokErr } = await supabase
      .from("ml_tokens")
      .upsert(
        {
          account_id: accountId,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id" }
      );
    if (tokErr) {
      console.error("[ML callback] update tokens error:", tokErr);
      return failRedirect("Erro ao salvar tokens. Tente novamente.", "db_error");
    }
  } else {
    const { data: anyAccount } = await supabase
      .from("ml_accounts")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (anyAccount) {
      return failRedirect("Apenas uma conta do Mercado Livre é permitida por login.", "already_connected");
    }
    const { data: newAccount, error: accErr } = await supabase
      .from("ml_accounts")
      .insert({
        user_id: user.id,
        ml_user_id: mlUserId,
        ml_nickname: mlNickname,
        site_id: siteId,
      })
      .select("id")
      .single();
    if (accErr) {
      console.error("[ML callback] insert account error:", accErr);
      return failRedirect("Erro ao criar conta no banco. Verifique as permissões (RLS/Supabase).", "db_error");
    }
    accountId = newAccount!.id;
    const { error: tokErr } = await supabase.from("ml_tokens").insert({
      account_id: accountId,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
    });
    if (tokErr) {
      console.error("[ML callback] insert tokens error:", tokErr);
      return failRedirect("Erro ao salvar tokens. Tente novamente.", "db_error");
    }
  }

  const res = NextResponse.redirect(`${appUrl}/app/configuracao?connected=1`, { status: 302 });
  res.cookies.delete("ml_oauth_state");
  res.cookies.delete("ml_oauth_code_verifier");
  return res;
}
