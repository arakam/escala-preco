import { type EmailOtpType } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

type CookieOption = { name: string; value: string; options?: Record<string, unknown> };

/**
 * Troca token_hash (email PKCE) por sessão em cookie.
 * No Supabase, ajuste o template "Reset password" para apontar para esta URL com token_hash e type=recovery.
 */
export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const nextRaw = request.nextUrl.searchParams.get("next") ?? "/auth/reset-password";
  const next =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/auth/reset-password";

  const failRedirect = NextResponse.redirect(
    new URL("/auth/forgot-password?erro=link", request.nextUrl.origin)
  );

  if (!token_hash || !type) {
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

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash,
  });

  if (error) {
    return failRedirect;
  }

  return response;
}
