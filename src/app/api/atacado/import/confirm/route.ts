import { createClient } from "@/lib/supabase/server";
import { parseWholesaleCsv } from "@/lib/atacado-import-csv";
import { NextRequest, NextResponse } from "next/server";

type ValidItem = { item_id: string; variation_id: number | null; tiers: { min_qty: number; price: number }[] };

/**
 * POST /api/atacado/import/confirm
 * Aceita:
 * - JSON: { accountId, items: ValidItem[] } — persiste exatamente os itens do preview (recomendado).
 * - multipart/form-data: file (CSV), accountId — parseia de novo e persiste (fallback).
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

  const contentType = request.headers.get("content-type") ?? "";
  let accountId: string | null = null;
  let validItems: ValidItem[] = [];

  if (contentType.includes("application/json")) {
    console.log("[atacado/import/confirm] Recebendo JSON");
    let body: { accountId?: string; items?: ValidItem[] };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }
    accountId = body.accountId?.toString()?.trim() ?? null;
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({
        ok: false,
        saved_count: 0,
        error: "Envie 'items' (array) com os dados do preview.",
      });
    }
    validItems = items.map((row) => ({
      item_id: String(row.item_id ?? "").trim().toUpperCase(),
      variation_id: row.variation_id != null ? Number(row.variation_id) : null,
      tiers: Array.isArray(row.tiers) ? row.tiers : [],
    })).filter((row) => row.item_id && row.tiers.length > 0);
    console.log("[atacado/import/confirm] Itens após normalizar:", validItems.length, validItems.map((r) => r.item_id));
    if (validItems.length === 0) {
      return NextResponse.json({
        ok: false,
        saved_count: 0,
        error: "Nenhum item válido em 'items' (item_id e tiers obrigatórios).",
      });
    }
  } else {
    console.log("[atacado/import/confirm] Recebendo multipart (arquivo CSV)");
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Corpo multipart inválido" }, { status: 400 });
    }
    accountId = formData.get("accountId")?.toString()?.trim() ?? null;
    if (!accountId) {
      return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
    }
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Envie o arquivo CSV no campo 'file'" }, { status: 400 });
    }
    const buffer = await file.arrayBuffer();
    const result = parseWholesaleCsv(buffer);
    if (result.headerError) {
      return NextResponse.json({ ok: false, saved_count: 0, error: result.headerError });
    }
    if (result.valid_items.length === 0) {
      return NextResponse.json({
        ok: false,
        saved_count: 0,
        error: "Nenhuma linha válida para importar.",
      });
    }
    validItems = result.valid_items.map((row) => ({
      ...row,
      item_id: String(row.item_id ?? "").trim().toUpperCase(),
    }));
  }

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

  const now = new Date().toISOString();
  let savedCount = 0;
  const errors: string[] = [];

  console.log("[atacado/import/confirm] Gravando", validItems.length, "itens em wholesale_drafts");

  for (const row of validItems) {
    const { error } = await supabase.from("wholesale_drafts").upsert(
      {
        account_id: accountId,
        item_id: row.item_id,
        variation_id: row.variation_id,
        tiers_json: row.tiers,
        source: "import",
        updated_at: now,
      },
      { onConflict: "account_id,item_id,variation_id" }
    );
    if (error) {
      console.error("[atacado/import/confirm] Upsert falhou:", row.item_id, error.message, error.code);
      errors.push(`${row.item_id}${row.variation_id != null ? ` (var ${row.variation_id})` : ""}: ${error.message}`);
      continue;
    }
    savedCount++;
  }

  console.log("[atacado/import/confirm] Gravados:", savedCount, "erros:", errors.length);

  if (savedCount === 0 && errors.length > 0) {
    return NextResponse.json({
      ok: false,
      saved_count: 0,
      error: "Nenhuma linha gravada.",
      details: errors,
    });
  }

  return NextResponse.json({
    ok: true,
    saved_count: savedCount,
    ...(errors.length > 0 && { warning: `${errors.length} linha(s) com falha.`, details: errors }),
  });
}
