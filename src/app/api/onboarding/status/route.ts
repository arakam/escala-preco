import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export type OnboardingStatusResponse = {
  ml_connected: boolean;
  listings_synced: boolean;
  products_imported: boolean;
  /** 1–4: primeiro passo ainda pendente (4 = tudo completo para liberar preço/atacado) */
  current_step: 1 | 2 | 3 | 4;
};

/**
 * GET /api/onboarding/status?accountId=opcional
 * Conta nova: sequência ML → sync → produtos → preço/atacado.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let accountId = request.nextUrl.searchParams.get("accountId")?.trim() ?? null;

  const { data: userAccounts, error: accErr } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (accErr) {
    console.error("[onboarding/status] ml_accounts:", accErr);
    return NextResponse.json({ error: "Erro ao carregar contas" }, { status: 500 });
  }

  const ml_connected = (userAccounts?.length ?? 0) > 0;

  const ownedIds = new Set((userAccounts ?? []).map((a) => a.id));
  if (accountId && !ownedIds.has(accountId)) {
    accountId = null;
  }
  if (!accountId && userAccounts?.length) {
    accountId = userAccounts[0].id;
  }

  let listings_synced = false;
  if (accountId && ml_connected) {
    const { count, error: itemsErr } = await supabase
      .from("ml_items")
      .select("item_id", { count: "exact", head: true })
      .eq("account_id", accountId);

    if (itemsErr) {
      console.error("[onboarding/status] ml_items:", itemsErr);
      return NextResponse.json({ error: "Erro ao verificar anúncios" }, { status: 500 });
    }
    listings_synced = (count ?? 0) > 0;
  }

  const { count: productCount, error: prodErr } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (prodErr) {
    console.error("[onboarding/status] products:", prodErr);
    return NextResponse.json({ error: "Erro ao verificar produtos" }, { status: 500 });
  }

  const products_imported = (productCount ?? 0) > 0;

  let current_step: 1 | 2 | 3 | 4 = 4;
  if (!ml_connected) current_step = 1;
  else if (!listings_synced) current_step = 2;
  else if (!products_imported) current_step = 3;

  const body: OnboardingStatusResponse = {
    ml_connected,
    listings_synced,
    products_imported,
    current_step,
  };

  return NextResponse.json(body);
}
