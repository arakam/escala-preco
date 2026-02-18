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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const redirectFail = `${appUrl}/app/mercadolivre?error=oauth_failed`;

  if (errorParam) {
    console.error("[ML callback] OAuth error:", errorParam, searchParams.get("error_description"));
    return NextResponse.redirect(`${redirectFail}&message=${encodeURIComponent(errorParam)}`);
  }

  if (!code || !state) {
    console.error("[ML callback] code ou state ausentes");
    return NextResponse.redirect(redirectFail);
  }

  const cookieState = request.cookies.get("ml_oauth_state")?.value;
  if (!cookieState) {
    console.error("[ML callback] cookie state ausente");
    return NextResponse.redirect(redirectFail);
  }
  const expectedState = createHash("sha256").update(cookieState).digest("hex");
  if (state !== expectedState) {
    console.error("[ML callback] state inválido");
    return NextResponse.redirect(redirectFail);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${appUrl}/auth/login?redirect=/app/mercadolivre`);
  }

  const clientId = process.env.MERCADOLIVRE_CLIENT_ID;
  const clientSecret = process.env.MERCADOLIVRE_CLIENT_SECRET;
  const redirectUri = process.env.MERCADOLIVRE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    console.error("[ML callback] env vars ausentes");
    return NextResponse.redirect(redirectFail);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
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
    return NextResponse.redirect(redirectFail);
  }

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error("[ML callback] token response not ok:", tokenRes.status, errBody);
    return NextResponse.redirect(redirectFail);
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
    return NextResponse.redirect(redirectFail);
  }

  if (!meRes.ok) {
    console.error("[ML callback] me response not ok:", meRes.status);
    return NextResponse.redirect(redirectFail);
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
      return NextResponse.redirect(redirectFail);
    }
  } else {
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
      return NextResponse.redirect(redirectFail);
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
      return NextResponse.redirect(redirectFail);
    }
  }

  const res = NextResponse.redirect(`${appUrl}/app/mercadolivre?connected=1`, { status: 302 });
  res.cookies.delete("ml_oauth_state");
  return res;
}
