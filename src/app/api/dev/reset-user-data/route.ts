import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function isDevResetAllowed(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * POST /api/dev/reset-user-data
 * Apenas com NODE_ENV=development (npm run dev). Remove conta(s) ML, tokens e dados
 * derivados (CASCADE) e apaga todos os produtos do usuário logado.
 */
export async function POST() {
  if (!isDevResetAllowed()) {
    return NextResponse.json({ error: "Não disponível" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { error: accErr } = await supabase.from("ml_accounts").delete().eq("user_id", user.id);
  if (accErr) {
    console.error("[dev/reset-user-data] ml_accounts:", accErr);
    return NextResponse.json({ error: "Erro ao desconectar Mercado Livre" }, { status: 500 });
  }

  const { error: prodErr } = await supabase.from("products").delete().eq("user_id", user.id);
  if (prodErr) {
    console.error("[dev/reset-user-data] products:", prodErr);
    return NextResponse.json({ error: "Erro ao apagar produtos" }, { status: 500 });
  }

  await supabase.from("operational_costs").delete().eq("user_id", user.id);
  await supabase.from("tax_parameters").delete().eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
