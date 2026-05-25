import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getValidAccessToken } from "./refresh";

export interface MlAccountRow {
  id: string;
  ml_user_id: number;
  ml_nickname: string | null;
}

export async function getMlAccountAndAccessToken(
  userId: string,
  userSupabase: SupabaseClient
): Promise<
  | { account: MlAccountRow; accessToken: string; adminSupabase: SupabaseClient }
  | { error: string; status: number }
> {
  const { data: account, error: accountError } = await userSupabase
    .from("ml_accounts")
    .select("id, ml_user_id, ml_nickname")
    .eq("user_id", userId)
    .single();

  if (accountError || !account) {
    return { error: "Conta ML não encontrada", status: 404 };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return { error: "Configuração do servidor incompleta", status: 500 };
  }

  const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);

  const { data: tokenData, error: tokenError } = await adminSupabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", account.id)
    .single();

  if (tokenError || !tokenData) {
    return { error: "Token não encontrado", status: 404 };
  }

  const token = tokenData as { access_token: string; refresh_token: string; expires_at: string };
  const accessToken = await getValidAccessToken(
    account.id,
    token.access_token,
    token.refresh_token,
    token.expires_at,
    adminSupabase
  );

  if (!accessToken) {
    return { error: "Falha ao obter token válido", status: 401 };
  }

  return { account, accessToken, adminSupabase };
}
