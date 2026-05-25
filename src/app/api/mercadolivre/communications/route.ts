import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { getMlAccountAndAccessToken } from "@/lib/mercadolivre/account-token";
import { syncCommunicationNoticesForAccount } from "@/lib/mercadolivre/communications";

/**
 * GET /api/mercadolivre/communications?sync=1
 * Lista comunicações do vendedor (sincroniza com a API do ML quando sync=1 ou na primeira carga).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const url = new URL(request.url);
  const forceSync = url.searchParams.get("sync") === "1";

  const auth = await getMlAccountAndAccessToken(user.id, supabase);
  if ("error" in auth) {
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
    forceSync ||
    !latest?.synced_at ||
    Date.now() - new Date(latest.synced_at).getTime() > staleMs;

  let syncMeta: { synced: number; removed: number } | null = null;
  if (needsSync) {
    try {
      syncMeta = await syncCommunicationNoticesForAccount(
        supabase,
        user.id,
        account.id,
        accessToken
      );
    } catch (e) {
      console.error("[ML communications] sync:", e);
      const msg = e instanceof Error ? e.message : "Erro ao sincronizar comunicações";
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  const { data: notices, error } = await supabase
    .from("ml_communication_notices")
    .select(
      "id, notice_id, label, title, description, highlighted, from_date, category, sub_category, tags, actions, dismiss_key, read_at, synced_at, created_at"
    )
    .eq("user_id", user.id)
    .eq("account_id", account.id)
    .order("from_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[ML communications] list:", error);
    return NextResponse.json({ error: "Erro ao listar comunicações" }, { status: 500 });
  }

  const unreadCount = (notices ?? []).filter((n) => !n.read_at).length;

  return NextResponse.json({
    notices: notices ?? [],
    unread_count: unreadCount,
    synced: needsSync,
    sync_meta: syncMeta,
  });
}
