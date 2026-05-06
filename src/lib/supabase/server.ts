import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieOption[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignore em Server Components
          }
        },
      },
      global: {
        fetch: resilientFetch,
      },
    }
  );
}
