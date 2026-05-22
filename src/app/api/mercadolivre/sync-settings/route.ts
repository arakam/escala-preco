import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/mercadolivre/sync-settings
 * Lista contas ML do usuário com flags de sincronização.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("ml_accounts")
    .select(
      "id, ml_user_id, ml_nickname, site_id, auto_sync_items_webhook, auto_create_products_on_sync"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[sync-settings] GET:", error);
    return NextResponse.json({ error: "Erro ao carregar configurações" }, { status: 500 });
  }

  return NextResponse.json({ accounts: data ?? [] });
}

/**
 * PATCH /api/mercadolivre/sync-settings
 * Body: { account_id, auto_sync_items_webhook?, auto_create_products_on_sync? }
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: {
    account_id?: string;
    auto_sync_items_webhook?: boolean;
    auto_create_products_on_sync?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  const accountId = body.account_id;
  if (!accountId || typeof accountId !== "string") {
    return NextResponse.json({ error: "account_id é obrigatório" }, { status: 400 });
  }

  const patch: Record<string, boolean> = {};
  if (typeof body.auto_sync_items_webhook === "boolean") {
    patch.auto_sync_items_webhook = body.auto_sync_items_webhook;
  }
  if (typeof body.auto_create_products_on_sync === "boolean") {
    patch.auto_create_products_on_sync = body.auto_create_products_on_sync;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Informe ao menos uma flag para atualizar" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ml_accounts")
    .update(patch)
    .eq("id", accountId)
    .eq("user_id", user.id)
    .select("id, ml_user_id, ml_nickname, auto_sync_items_webhook, auto_create_products_on_sync")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  return NextResponse.json({ account: data });
}
