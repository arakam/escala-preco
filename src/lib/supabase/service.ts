/**
 * Cliente Supabase com service role - APENAS para uso no servidor (workers, cron).
 * Bypassa RLS. Usar somente em contexto onde a autorização já foi feita (ex: job criado pelo user).
 */
import { createClient } from "@supabase/supabase-js";

let serviceClient: ReturnType<typeof createClient> | null = null;

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
