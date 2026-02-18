import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";

const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";

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
    return NextResponse.redirect(new URL("/auth/login?redirect=/app/mercadolivre", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001"));
  }
  const state = randomBytes(24).toString("hex");
  const stateHash = createHash("sha256").update(state).digest("hex");
  const url = new URL(ML_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", stateHash);
  const res = NextResponse.redirect(url.toString(), { status: 302 });
  res.cookies.set("ml_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/" });
  return res;
}
