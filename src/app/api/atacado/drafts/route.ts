import { createClient } from "@/lib/supabase/server";
import { validateDraftRow, normalizeTiers } from "@/lib/atacado";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/atacado/drafts
 * Body: { accountId, rows: [{ item_id, variation_id|null, tiers:[{min_qty, price}...] }] }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: { accountId?: string; rows?: Array<{ item_id: string; variation_id: number | null; tiers: { min_qty: number; price: number }[] }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo JSON inválido" }, { status: 400 });
  }

  const { accountId, rows } = body;
  if (!accountId?.trim()) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows deve ser um array não vazio" }, { status: 400 });
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

  const errors: Array<{ item_id: string; variation_id: number | null; field: string; message: string }> = [];
  const toUpsert: Array<{ item_id: string; variation_id: number | null; tiers: { min_qty: number; price: number }[] }> = [];

  for (const row of rows) {
    const itemId = row?.item_id?.trim?.();
    const variationId = row?.variation_id != null ? Number(row.variation_id) : null;
    if (!itemId) {
      errors.push({ item_id: row?.item_id ?? "", variation_id: variationId, field: "item_id", message: "item_id obrigatório" });
      continue;
    }

    const rawTiers = Array.isArray(row.tiers) ? row.tiers : [];
    const tiers = normalizeTiers(
      rawTiers
        .filter((t) => t && typeof t === "object")
        .map((t) => ({
          min_qty: Number(t.min_qty),
          price: Number(t.price),
        }))
        .filter((t) => !Number.isNaN(t.min_qty) && !Number.isNaN(t.price))
    );

    if (tiers.length > 0) {
      const rowInput = { item_id: itemId, variation_id: variationId, tiers };
      const rowErrors = validateDraftRow(rowInput);
      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        continue;
      }
    }

    toUpsert.push({ item_id: itemId, variation_id: variationId, tiers });
  }

  if (toUpsert.length === 0 && errors.length > 0) {
    return NextResponse.json({
      ok: false,
      saved_count: 0,
      errors,
    });
  }

  let savedCount = 0;
  const now = new Date().toISOString();

  for (const row of toUpsert) {
    if (row.tiers.length === 0) {
      const q = supabase
        .from("wholesale_drafts")
        .delete()
        .eq("account_id", accountId)
        .eq("item_id", row.item_id);
      const q2 = row.variation_id != null ? q.eq("variation_id", row.variation_id) : q.is("variation_id", null);
      const { error } = await q2;
      if (!error) savedCount++;
    } else {
      const { error } = await supabase.from("wholesale_drafts").upsert(
        {
          account_id: accountId,
          item_id: row.item_id,
          variation_id: row.variation_id,
          tiers_json: row.tiers,
          source: "manual",
          updated_at: now,
        },
        {
          onConflict: "account_id,item_id,variation_id",
        }
      );
      if (!error) savedCount++;
      else {
        errors.push({
          item_id: row.item_id,
          variation_id: row.variation_id,
          field: "db",
          message: error.message,
        });
      }
    }
  }

  return NextResponse.json({
    ok: errors.length === 0 || savedCount > 0,
    saved_count: savedCount,
    errors: errors.length > 0 ? errors : undefined,
  });
}
