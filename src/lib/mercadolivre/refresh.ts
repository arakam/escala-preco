/**
 * Refresh do access_token ML quando expirar ou estiver próximo.
 * Atualiza ml_tokens no Supabase.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const ML_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

export async function refreshMLAccessToken(
  accountId: string,
  refreshToken: string,
  supabase: SupabaseClient
): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  const clientId = process.env.MERCADOLIVRE_CLIENT_ID;
  const clientSecret = process.env.MERCADOLIVRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[ML refresh] MERCADOLIVRE_CLIENT_ID ou MERCADOLIVRE_CLIENT_SECRET ausentes");
    return null;
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  let res: Response;
  try {
    res = await fetch(ML_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
  } catch (e) {
    console.error("[ML refresh] fetch error:", e);
    return null;
  }
  if (!res.ok) {
    const errBody = await res.text();
    console.error("[ML refresh] token response not ok:", res.status, errBody);
    return null;
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  const { error } = await supabase
    .from("ml_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId);
  if (error) {
    console.error("[ML refresh] update tokens error:", error);
    return null;
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_in: data.expires_in };
}

/**
 * Retorna access_token válido: usa o atual se ainda válido (com margem de 5 min),
 * senão faz refresh e retorna o novo.
 */
export async function getValidAccessToken(
  accountId: string,
  currentAccessToken: string,
  refreshToken: string,
  expiresAt: string,
  supabase: SupabaseClient
): Promise<string | null> {
  const margin = 5 * 60 * 1000; // 5 min
  if (new Date(expiresAt).getTime() - margin > Date.now()) {
    return currentAccessToken;
  }
  const refreshed = await refreshMLAccessToken(accountId, refreshToken, supabase);
  return refreshed ? refreshed.access_token : null;
}
