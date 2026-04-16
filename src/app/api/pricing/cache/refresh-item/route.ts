/**
 * POST /api/pricing/cache/refresh-item
 * Body: { item_id: "MLB123" }
 * Atualiza no cache apenas as linhas desse item (e variações). Use após editar um anúncio ou para atualizar um item.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshPricingCacheByItemId } from "@/lib/pricing-cache";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  let body: { item_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const itemId = typeof body?.item_id === "string" ? body.item_id.trim().toUpperCase() : "";
  if (!itemId || !itemId.startsWith("MLB")) {
    return NextResponse.json({ error: "Informe item_id (ex.: MLB123456789)" }, { status: 400 });
  }

  const result = await refreshPricingCacheByItemId(account.id, itemId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: result.count });
}
