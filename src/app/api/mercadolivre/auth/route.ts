import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";

const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";

/** Gera code_verifier PKCE (43-128 chars) e code_challenge S256. */
function generatePKCE() {
  const verifier = randomBytes(32).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const challenge = createHash("sha256").update(verifier).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return { code_verifier: verifier, code_challenge: challenge };
}

export async function GET() {
  const clientId = process.env.MERCADOLIVRE_CLIENT_ID;
  const redirectUri = process.env.MERCADOLIVRE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    console.error("[ML auth] MERCADOLIVRE_CLIENT_ID ou MERCADOLIVRE_REDIRECT_URI ausentes");
    return NextResponse.json(
      { error: "Configuração OAuth incompleta" },
      { status: 500 }
    );
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth/login?redirect=/app/configuracao", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"));
  }
  const { data: existing } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (existing) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
    return NextResponse.redirect(`${appUrl}/app/configuracao?error=oauth_failed&message=${encodeURIComponent("Apenas uma conta do Mercado Livre é permitida por login.")}&reason=already_connected`);
  }
  const state = randomBytes(24).toString("hex");
  const stateHash = createHash("sha256").update(state).digest("hex");
  const { code_verifier, code_challenge } = generatePKCE();

  const url = new URL(ML_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", stateHash);
  url.searchParams.set("code_challenge", code_challenge);
  url.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(url.toString(), { status: 302 });
  const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, maxAge: 600, path: "/" };
  res.cookies.set("ml_oauth_state", state, cookieOpts);
  res.cookies.set("ml_oauth_code_verifier", code_verifier, cookieOpts);
  return res;
}
