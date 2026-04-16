/**
 * Cliente Supabase com service role - APENAS para uso no servidor (workers, cron).
 * Bypassa RLS. Usar somente em contexto onde a autorização já foi feita (ex: job criado pelo user).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** `ReturnType<typeof createClient>` colapsa o schema para `never` no TS 5.x; `SupabaseClient` usa defaults seguros. */
let serviceClient: SupabaseClient | null = null;

export function createServiceClient() {
  if (serviceClient) return serviceClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessários para o worker de sync");
  }
  serviceClient = createClient(url, key);
  return serviceClient;
}
