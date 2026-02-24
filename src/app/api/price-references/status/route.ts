import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/price-references/status?accountId=...
 * Retorna contagens por status e última atualização.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId")?.trim();
  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }

  const { data: account } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();
  if (!account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  const { data: refs } = await supabase
    .from("price_references")
    .select("status, updated_at")
    .eq("account_id", accountId);

  let high = 0;
  let attention = 0;
  let competitive = 0;
  let none = 0;
  let updated_at_last: string | null = null;

  for (const r of refs ?? []) {
    switch (r.status) {
      case "high":
        high++;
        break;
      case "attention":
        attention++;
        break;
      case "competitive":
        competitive++;
        break;
      default:
        none++;
    }
    if (r.updated_at) {
      if (!updated_at_last || r.updated_at > updated_at_last) updated_at_last = r.updated_at;
    }
  }

  return NextResponse.json({
    high,
    attention,
    competitive,
    none,
    updated_at_last,
  });
}
