import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieOption = { name: string; value: string; options?: Record<string, unknown> };

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
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
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isApp = request.nextUrl.pathname.startsWith("/app");

  /** Repassa cookies da resposta do Supabase (refresh etc.) sem forçar httpOnly — forçar httpOnly quebra cookies usados pelo client @supabase/ssr. */
  function forwardCookies(to: NextResponse) {
    supabaseResponse.cookies.getAll().forEach((c) => {
      to.cookies.set(c.name, c.value);
    });
  }

  if (isApp && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    const redirect = NextResponse.redirect(url);
    forwardCookies(redirect);
    return redirect;
  }
  if (user && (request.nextUrl.pathname === "/auth/login" || request.nextUrl.pathname === "/auth/register")) {
    const url = request.nextUrl.clone();
    const dest = request.nextUrl.searchParams.get("redirect");
    const safe =
      dest && dest.startsWith("/") && !dest.startsWith("//") ? dest : "/app";
    url.pathname = safe;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    forwardCookies(redirect);
    return redirect;
  }
  return supabaseResponse;
}
