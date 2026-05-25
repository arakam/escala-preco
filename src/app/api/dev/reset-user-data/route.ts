import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

function isDevResetAllowed(): boolean {
  return process.env.NODE_ENV === "development";
}

async function deleteOrFail(
  label: string,
  op: PromiseLike<{ error: PostgrestError | null }>
): Promise<PostgrestError | null> {
  const { error } = await op;
  if (error) {
    console.error(`[dev/reset-user-data] ${label}:`, error);
  }
  return error;
}

/**
 * POST /api/dev/reset-user-data
 * Apenas com NODE_ENV=development (npm run dev). Remove conta(s) ML, tokens e dados
 * derivados (cache de preços, promoções, webhooks, jobs, anúncios, vendas, rascunhos, referências)
 * e apaga produtos, tags, custos operacionais e parâmetros fiscais deste usuário.
 *
 * Não apaga ml_category_fee_reference (referência global por site/categoria/tipo de listagem).
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

  const { data: accounts, error: listErr } = await supabase
    .from("ml_accounts")
    .select("id")
    .eq("user_id", user.id);

  if (listErr) {
    console.error("[dev/reset-user-data] ml_accounts list:", listErr);
    return NextResponse.json({ error: "Erro ao listar contas Mercado Livre" }, { status: 500 });
  }

  const accountIds = (accounts ?? []).map((r) => r.id).filter(Boolean);

  const userScoped: Array<[string, PromiseLike<{ error: PostgrestError | null }>]> = [
    ["promotions_cache_rows", supabase.from("promotions_cache_rows").delete().eq("user_id", user.id)],
    ["ml_webhook_notifications", supabase.from("ml_webhook_notifications").delete().eq("user_id", user.id)],
    ["ml_promotion_webhook_alerts", supabase.from("ml_promotion_webhook_alerts").delete().eq("user_id", user.id)],
    ["ml_order_items", supabase.from("ml_order_items").delete().eq("user_id", user.id)],
    ["ml_orders", supabase.from("ml_orders").delete().eq("user_id", user.id)],
    ["ml_sales_sync_state", supabase.from("ml_sales_sync_state").delete().eq("user_id", user.id)],
  ];

  for (const [label, op] of userScoped) {
    const err = await deleteOrFail(label, op);
    if (err) {
      return NextResponse.json({ error: `Erro ao limpar ${label}` }, { status: 500 });
    }
  }

  if (accountIds.length > 0) {
    const accountScoped: Array<[string, PromiseLike<{ error: PostgrestError | null }>]> = [
      ["pricing_cache", supabase.from("pricing_cache").delete().in("account_id", accountIds)],
      ["planned_prices", supabase.from("planned_prices").delete().in("account_id", accountIds)],
      ["price_references", supabase.from("price_references").delete().in("account_id", accountIds)],
      ["wholesale_drafts", supabase.from("wholesale_drafts").delete().in("account_id", accountIds)],
      ["ml_jobs", supabase.from("ml_jobs").delete().in("account_id", accountIds)],
      ["ml_variations", supabase.from("ml_variations").delete().in("account_id", accountIds)],
      ["ml_items", supabase.from("ml_items").delete().in("account_id", accountIds)],
      ["ml_tokens", supabase.from("ml_tokens").delete().in("account_id", accountIds)],
    ];

    for (const [label, op] of accountScoped) {
      const err = await deleteOrFail(label, op);
      if (err) {
        return NextResponse.json({ error: `Erro ao limpar ${label}` }, { status: 500 });
      }
    }
  }

  const { error: accErr } = await supabase.from("ml_accounts").delete().eq("user_id", user.id);
  if (accErr) {
    console.error("[dev/reset-user-data] ml_accounts:", accErr);
    return NextResponse.json({ error: "Erro ao desconectar Mercado Livre" }, { status: 500 });
  }

  const { data: products } = await supabase
    .from("products")
    .select("id")
    .eq("user_id", user.id);
  const productIds = (products ?? []).map((p) => p.id).filter(Boolean);

  if (productIds.length > 0) {
    const assignErr = await deleteOrFail(
      "product_tag_assignments",
      supabase.from("product_tag_assignments").delete().in("product_id", productIds)
    );
    if (assignErr) {
      return NextResponse.json({ error: "Erro ao limpar tags de produtos" }, { status: 500 });
    }
  }

  const tagErr = await deleteOrFail(
    "product_tags",
    supabase.from("product_tags").delete().eq("user_id", user.id)
  );
  if (tagErr) {
    return NextResponse.json({ error: "Erro ao limpar product_tags" }, { status: 500 });
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
