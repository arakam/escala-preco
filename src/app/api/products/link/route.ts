import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  linkMlItemsToProducts,
  refreshPricingCacheForUser,
} from "@/lib/products/refresh-pricing-after-product-change";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let result: { items_linked: number; variations_linked: number; total_linked: number };
  try {
    result = await linkMlItemsToProducts(supabase, user.id);
  } catch (error) {
    console.error("Erro ao vincular produtos:", error);
    return NextResponse.json(
      { error: "Erro ao vincular produtos aos anúncios" },
      { status: 500 }
    );
  }

  let cacheRefresh: { ok: boolean; count?: number; error?: string } | null = null;
  if (result.total_linked > 0) {
    try {
      cacheRefresh = await refreshPricingCacheForUser(supabase, user.id);
    } catch (err) {
      console.error("[products/link] pricing cache refresh:", err);
      cacheRefresh = { ok: false, error: "Erro ao atualizar cache de preços" };
    }
  }

  return NextResponse.json({
    success: true,
    items_linked: result.items_linked,
    variations_linked: result.variations_linked,
    total_linked: result.total_linked,
    cache_refresh: cacheRefresh,
  });
}
