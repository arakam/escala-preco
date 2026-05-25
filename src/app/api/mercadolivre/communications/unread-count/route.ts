import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getMlAccountAndAccessToken } from "@/lib/mercadolivre/account-token";
import { syncCommunicationNoticesForAccount } from "@/lib/mercadolivre/communications";

/**
 * GET /api/mercadolivre/communications/unread-count
 * Contagem de comunicações não lidas (sincroniza em background se dados antigos).
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const auth = await getMlAccountAndAccessToken(user.id, supabase);
  if ("error" in auth) {
    if (auth.status === 404) {
      return NextResponse.json({ unread_count: 0, connected: false });
    }
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { account, accessToken } = auth;

  const { data: latest } = await supabase
    .from("ml_communication_notices")
    .select("synced_at")
    .eq("account_id", account.id)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const staleMs = 15 * 60 * 1000;
  const needsSync =
    !latest?.synced_at || Date.now() - new Date(latest.synced_at).getTime() > staleMs;

  if (needsSync) {
    try {
      await syncCommunicationNoticesForAccount(supabase, user.id, account.id, accessToken);
    } catch (e) {
      console.error("[ML communications/unread-count] sync:", e);
    }
  }

  const { count, error } = await supabase
    .from("ml_communication_notices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("account_id", account.id)
    .is("read_at", null);

  if (error) {
    console.error("[ML communications/unread-count]:", error);
    return NextResponse.json({ error: "Erro ao contar comunicações" }, { status: 500 });
  }

  return NextResponse.json({
    unread_count: count ?? 0,
    connected: true,
  });
}
