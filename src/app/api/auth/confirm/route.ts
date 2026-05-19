import { type EmailOtpType } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

type CookieOption = { name: string; value: string; options?: Record<string, unknown> };

/**
 * Troca token_hash ou code do email por sessão em cookie (servidor).
 * Usado pelo template de email com {{ .TokenHash }} (não depende de PKCE no navegador).
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const nextRaw = request.nextUrl.searchParams.get("next") ?? "/auth/reset-password";
  const next =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/auth/reset-password";

  const failRedirect = NextResponse.redirect(
    new URL("/auth/forgot-password?erro=link", request.nextUrl.origin)
  );

  if (!code && (!token_hash || !type)) {
    return failRedirect;
  }

  const okUrl = new URL(next, request.nextUrl.origin);
  let response = NextResponse.redirect(okUrl);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieOption[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.warn("[api/auth/confirm] exchangeCodeForSession:", error.message);
      return failRedirect;
    }
    return response;
  }

  const { error } = await supabase.auth.verifyOtp({
    type: type!,
    token_hash: token_hash!,
  });

  if (error) {
    console.warn("[api/auth/confirm] verifyOtp:", error.message);
    return failRedirect;
  }

  return response;
}
