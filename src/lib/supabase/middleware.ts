import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

type CookieOption = { name: string; value: string; options?: Record<string, unknown> };

/** Edge Middleware tem limite curto de execução; fetch lento com cookie inválido costuma virar 502 no proxy antes de responder. */
const MIDDLEWARE_SUPABASE_FETCH_TIMEOUT_MS = 5000;
const MIDDLEWARE_SUPABASE_FETCH_MAX_RETRIES = 0;

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

async function resilientFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: { timeoutMs: number; maxRetries: number }
) {
  const timeoutMs = opts?.timeoutMs ?? SUPABASE_FETCH_TIMEOUT_MS;
  const maxRetries = opts?.maxRetries ?? SUPABASE_FETCH_MAX_RETRIES;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error;
      }
      await delay(300 * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

/** Mesmos atributos que o browser usa para `sb-*` / OAuth; sem `path: '/'` o delete costuma não remover o cookie. */
const CLEAR_AUTH_COOKIE = {
  path: "/" as const,
  maxAge: 0,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

function collectSbCookieNames(request: NextRequest, fromResponse?: NextResponse) {
  const names = new Set<string>();
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith("sb-")) names.add(c.name);
  }
  if (fromResponse) {
    for (const c of fromResponse.cookies.getAll()) {
      if (c.name.startsWith("sb-")) names.add(c.name);
    }
  }
  return names;
}

function clearAuthCookies(request: NextRequest, to: NextResponse, fromResponse?: NextResponse) {
  for (const name of Array.from(collectSbCookieNames(request, fromResponse))) {
    to.cookies.set(name, "", CLEAR_AUTH_COOKIE);
  }
  for (const name of ["ml_oauth_state", "ml_oauth_code_verifier"] as const) {
    if (request.cookies.has(name)) {
      to.cookies.set(name, "", CLEAR_AUTH_COOKIE);
    }
  }
}

const middlewareSupabaseFetch: typeof fetch = (input, init) =>
  resilientFetch(input, init, {
    timeoutMs: MIDDLEWARE_SUPABASE_FETCH_TIMEOUT_MS,
    maxRetries: MIDDLEWARE_SUPABASE_FETCH_MAX_RETRIES,
  });

export async function updateSession(request: NextRequest) {
  try {
    return await runUpdateSession(request);
  } catch (error) {
    console.error("[middleware] falha inesperada, redirecionando e limpando sessão:", error);
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    url.searchParams.set("reason", "session_error");
    const redirect = NextResponse.redirect(url);
    clearAuthCookies(request, redirect);
    return redirect;
  }
}

async function runUpdateSession(request: NextRequest) {
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
        fetch: middlewareSupabaseFetch,
      },
    }
  );

  let user: User | null = null;
  try {
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError) {
      console.warn("[middleware] getUser:", authError.message);
      clearAuthCookies(request, supabaseResponse);
    } else {
      user = data.user;
    }
  } catch (error) {
    console.error("[middleware] erro ao validar sessão, limpando cookies:", error);
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    url.searchParams.set("reason", "session_reset");
    const redirect = NextResponse.redirect(url);
    clearAuthCookies(request, redirect, supabaseResponse);
    return redirect;
  }
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
    clearAuthCookies(request, redirect, supabaseResponse);
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
