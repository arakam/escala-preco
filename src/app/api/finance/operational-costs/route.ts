import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { OPERATIONAL_COST_CATEGORIES, isOperationalCategoryKey } from "@/lib/finance-categories";

/**
 * GET — lista todas as categorias com valores (0 se ainda não salvo).
 * PUT — body: { rows: { category_key, monthly_amount }[] }
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
    .from("operational_costs")
    .select("category_key, monthly_amount")
    .eq("user_id", user.id);

  if (error) {
    console.error("[operational-costs GET]", error);
    return NextResponse.json({ error: "Erro ao carregar custos" }, { status: 500 });
  }

  const byKey = new Map((dbRows ?? []).map((r) => [r.category_key, Number(r.monthly_amount)]));

  const rows = OPERATIONAL_COST_CATEGORIES.map((c) => ({
    category_key: c.key,
    label: c.label,
    examples: c.examples,
    monthly_amount: byKey.has(c.key) ? (byKey.get(c.key) as number) : 0,
  }));

  const total_monthly = rows.reduce((s, r) => s + (Number.isFinite(r.monthly_amount) ? r.monthly_amount : 0), 0);

  return NextResponse.json({ rows, total_monthly });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: { rows?: Array<{ category_key?: string; monthly_amount?: number }> };
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
    monthly_amount: number;
    updated_at: string;
  }> = [];

  for (const r of body.rows) {
    const key = r.category_key?.trim();
    if (!key || !isOperationalCategoryKey(key)) {
      return NextResponse.json({ error: `category_key inválido: ${key ?? ""}` }, { status: 400 });
    }
    const amt = r.monthly_amount;
    const n = typeof amt === "number" ? amt : Number(amt);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `Valor inválido para ${key}` }, { status: 400 });
    }
    payload.push({
      user_id: user.id,
      category_key: key,
      monthly_amount: Math.round(n * 100) / 100,
      updated_at: now,
    });
  }

  if (payload.length === 0) {
    return NextResponse.json({ error: "Nenhuma linha para salvar" }, { status: 400 });
  }

  const { error } = await supabase.from("operational_costs").upsert(payload, {
    onConflict: "user_id,category_key",
  });

  if (error) {
    console.error("[operational-costs PUT]", error);
    return NextResponse.json({ error: "Erro ao salvar custos" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved: payload.length });
}
