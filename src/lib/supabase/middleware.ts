import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieOption = { name: string; value: string; options?: Record<string, unknown> };

const SUPABASE_FETCH_TIMEOUT_MS = 20000;
const SUPABASE_FETCH_MAX_RETRIES = 2;
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }
  const maybeError = error as { code?: string; cause?: { code?: string } };
  return maybeError.code ?? maybeError.cause?.code ?? null;
}

function isRetryableError(error: unknown) {
  const code = getErrorCode(error);
  return !!code && RETRYABLE_NETWORK_CODES.has(code);
}

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= SUPABASE_FETCH_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt === SUPABASE_FETCH_MAX_RETRIES || !isRetryableError(error)) {
        throw error;
      }
      await delay(300 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

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
      global: {
        fetch: resilientFetch,
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
