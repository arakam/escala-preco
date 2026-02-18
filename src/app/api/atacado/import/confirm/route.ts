import { createClient } from "@/lib/supabase/server";
import { parseWholesaleCsv } from "@/lib/atacado-import-csv";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/atacado/import/confirm
 * multipart/form-data: file (CSV), accountId
 * Parseia novamente com ";", persiste apenas linhas válidas em wholesale_drafts com source='import'.
 * NÃO envia ao Mercado Livre.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Corpo multipart inválido" }, { status: 400 });
  }

  const accountId = formData.get("accountId")?.toString()?.trim();
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

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Envie o arquivo CSV no campo 'file'" }, { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  const result = parseWholesaleCsv(buffer);

  if (result.headerError) {
    return NextResponse.json({
      ok: false,
      saved_count: 0,
      error: result.headerError,
    });
  }

  if (result.valid_items.length === 0) {
    return NextResponse.json({
      ok: false,
      saved_count: 0,
      error: "Nenhuma linha válida para importar.",
    });
  }

  const now = new Date().toISOString();
  let savedCount = 0;

  for (const row of result.valid_items) {
    const { error } = await supabase.from("wholesale_drafts").upsert(
      {
        account_id: accountId,
        item_id: row.item_id,
        variation_id: row.variation_id,
        tiers_json: row.tiers,
        source: "import",
        updated_at: now,
      },
      {
        onConflict: "account_id,item_id,variation_id",
      }
    );
    if (!error) savedCount++;
  }

  return NextResponse.json({
    ok: true,
    saved_count: savedCount,
  });
}
