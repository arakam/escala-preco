import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TAX_PARAMETER_CATEGORIES, isTaxParameterCategoryKey } from "@/lib/finance-categories";

/**
 * GET — categorias de impostos com percentuais (0 se não salvo).
 * PUT — body: { rows: { category_key, percent }[] }
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { data: dbRows, error } = await supabase
    .from("tax_parameters")
    .select("category_key, percent")
    .eq("user_id", user.id);

  if (error) {
    console.error("[tax-parameters GET]", error);
    return NextResponse.json({ error: "Erro ao carregar impostos" }, { status: 500 });
  }

  const byKey = new Map((dbRows ?? []).map((r) => [r.category_key, Number(r.percent)]));

  const rows = TAX_PARAMETER_CATEGORIES.map((c) => ({
    category_key: c.key,
    label: c.label,
    examples: c.examples,
    percent: byKey.has(c.key) ? (byKey.get(c.key) as number) : 0,
  }));

  return NextResponse.json({ rows });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: { rows?: Array<{ category_key?: string; percent?: number }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ error: "rows deve ser um array" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const payload: Array<{
    user_id: string;
    category_key: string;
    percent: number;
    updated_at: string;
  }> = [];

  for (const r of body.rows) {
    const key = r.category_key?.trim();
    if (!key || !isTaxParameterCategoryKey(key)) {
      return NextResponse.json({ error: `category_key inválido: ${key ?? ""}` }, { status: 400 });
    }
    const p = r.percent;
    const n = typeof p === "number" ? p : Number(p);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return NextResponse.json(
        { error: `Percentual inválido para ${key} (use 0–100)` },
        { status: 400 }
      );
    }
    payload.push({
      user_id: user.id,
      category_key: key,
      percent: Math.round(n * 10000) / 10000,
      updated_at: now,
    });
  }

  if (payload.length === 0) {
    return NextResponse.json({ error: "Nenhuma linha para salvar" }, { status: 400 });
  }

  const { error } = await supabase.from("tax_parameters").upsert(payload, {
    onConflict: "user_id,category_key",
  });

  if (error) {
    console.error("[tax-parameters PUT]", error);
    return NextResponse.json({ error: "Erro ao salvar impostos" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved: payload.length });
}
