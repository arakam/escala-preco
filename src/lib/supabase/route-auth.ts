import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type RouteAuth = {
  supabase: SupabaseClient;
  user: User;
};

/**
 * Autenticação em Route Handlers. O middleware não cobre `/api/*`, então renovamos
 * a sessão aqui quando o access token expirou (ex.: importação CSV longa na tela).
 */
export async function getRouteAuth(): Promise<RouteAuth | null> {
  const supabase = await createClient();

  let {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.refresh_token) {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError) {
        ({
          data: { user },
        } = await supabase.auth.getUser());
      }
    }
  }

  if (!user) return null;
  return { supabase, user };
}
