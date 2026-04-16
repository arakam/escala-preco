/**
 * POST /api/pricing/cache/refresh
 * Atualiza o cache da tela de preços (dados de anúncios, produtos, preço planejado e vendas 30d).
 * Use após cadastrar novos anúncios ou vincular MLB-SKU, ou quando quiser dados mais recentes.
 */
import { NextResponse } from "next/server";

export const maxDuration = 120;
import { createClient } from "@/lib/supabase/server";
import { refreshPricingCache } from "@/lib/pricing-cache";

export async function POST() {
  try {
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

    const result = await refreshPricingCache(account.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, count: result.count });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro inesperado ao atualizar cache";
    console.error("[pricing/cache/refresh] Erro:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
