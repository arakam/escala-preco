import { createClient } from "@/lib/supabase/server";
import { syncSingleItem } from "@/lib/mercadolivre/sync-worker";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/mercadolivre/{accountId}/items/sync
 * Body: { item_id: string } - MLB do anúncio (ex.: MLB123456789)
 * Sincroniza um único anúncio por ID.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { accountId } = await params;
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

  let body: { item_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }
  const itemId = body?.item_id;
  if (!itemId || typeof itemId !== "string" || !itemId.trim()) {
    return NextResponse.json(
      { error: "item_id é obrigatório (ex.: MLB123456789)" },
      { status: 400 }
    );
  }

  const result = await syncSingleItem(accountId, itemId.trim());
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, message: "Anúncio sincronizado" });
}
