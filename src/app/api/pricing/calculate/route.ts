import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { fetchSaleFee } from "@/lib/mercadolivre/fees";
import { createServiceClient } from "@/lib/supabase/service";

interface CalculateRequest {
  items: {
    item_id: string;
    variation_id?: number | null;
    price: number;
    listing_type_id: string;
    category_id: string;
    weight_kg?: number | null;
    height_cm?: number | null;
    width_cm?: number | null;
    length_cm?: number | null;
  }[];
  is_mercado_lider?: boolean;
}

interface CalculatedItem {
  item_id: string;
  variation_id: number | null;
  price: number;
  fee: number;
  shipping_cost: number;
  net_amount: number;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = (await req.json()) as CalculateRequest;

  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "Nenhum item para calcular" }, { status: 400 });
  }

  if (body.items.length > 100) {
    return NextResponse.json({ error: "Máximo de 100 itens por requisição" }, { status: 400 });
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id, site_id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Configuração do servidor incompleta" }, { status: 500 });
  }

  const adminSupabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);

  const { data: tokenData, error: tokenError } = await adminSupabase
    .from("ml_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("account_id", account.id)
    .single();

  if (tokenError || !tokenData) {
    return NextResponse.json({ error: "Token não encontrado" }, { status: 404 });
  }

  const token = tokenData as { access_token: string; refresh_token: string; expires_at: string };

  const accessToken = await getValidAccessToken(
    account.id,
    token.access_token,
    token.refresh_token,
    token.expires_at,
    adminSupabase
  );

  if (!accessToken) {
    return NextResponse.json({ error: "Falha ao obter token válido" }, { status: 401 });
  }

  const siteId = account.site_id || "MLB";
  const isMercadoLider = body.is_mercado_lider ?? false;

  const { data: shippingRanges, error: shippingError } = await adminSupabase
    .from("ml_shipping_cost_ranges")
    .select("*")
    .order("weight_min_kg", { ascending: true });

  if (shippingError) {
    console.error("[Pricing calculate] Error fetching shipping ranges:", shippingError);
  }
  
  console.log("[Pricing calculate] is_mercado_lider:", isMercadoLider, "shipping ranges count:", shippingRanges?.length ?? 0);

  /** Peso efetivo para frete: o maior entre peso real e peso volumétrico (largura * altura * comprimento)/6000, como o ML usa. */
  const getEffectiveWeightKg = (
    weightKg: number | null | undefined,
    heightCm: number | null | undefined,
    widthCm: number | null | undefined,
    lengthCm: number | null | undefined
  ): number | null => {
    const real = weightKg != null && weightKg > 0 ? weightKg : null;
    const h = heightCm != null && heightCm > 0 ? heightCm : null;
    const w = widthCm != null && widthCm > 0 ? widthCm : null;
    const l = lengthCm != null && lengthCm > 0 ? lengthCm : null;
    const volumetric =
      h != null && w != null && l != null ? (h * w * l) / 6000 : null;
    if (real != null && volumetric != null) return Math.max(real, volumetric);
    if (real != null) return real;
    if (volumetric != null) return volumetric;
    return null;
  };

  const getShippingCost = (weightKg: number | null | undefined, price: number): number => {
    if (!isMercadoLider) {
      return 0;
    }
    
    if (!weightKg) {
      console.log("[Pricing calculate] No weight_kg provided for shipping calculation");
      return 0;
    }
    
    if (!shippingRanges || shippingRanges.length === 0) {
      console.log("[Pricing calculate] No shipping ranges available");
      return 0;
    }

    const range = shippingRanges.find(
      (r) => weightKg >= Number(r.weight_min_kg) && (r.weight_max_kg === null || weightKg < Number(r.weight_max_kg))
    );

    if (!range) {
      console.log("[Pricing calculate] No matching range for weight:", weightKg);
      return 0;
    }

    let cost = 0;
    if (price < 19) cost = Number(range.cost_0_to_18);
    else if (price < 49) cost = Number(range.cost_19_to_48);
    else if (price < 79) cost = Number(range.cost_49_to_78);
    else if (price < 100) cost = Number(range.cost_79_to_99);
    else if (price < 120) cost = Number(range.cost_100_to_119);
    else if (price < 150) cost = Number(range.cost_120_to_149);
    else if (price < 200) cost = Number(range.cost_150_to_199);
    else cost = Number(range.cost_200_plus);
    
    if (price < 19 && cost > price / 2) {
      cost = price / 2;
    }
    
    console.log("[Pricing calculate] Shipping cost for weight", weightKg, "price", price, "=", cost);
    return cost;
  };

  const results: CalculatedItem[] = [];
  const errors: { item_id: string; variation_id: number | null; error: string }[] = [];

  for (const item of body.items) {
    try {
      const price = Math.round(item.price * 100) / 100;
      const weightKg = item.weight_kg != null ? Number(item.weight_kg) : null;
      const heightCm = item.height_cm != null ? Number(item.height_cm) : null;
      const widthCm = item.width_cm != null ? Number(item.width_cm) : null;
      const lengthCm = item.length_cm != null ? Number(item.length_cm) : null;
      const effectiveWeightKg = getEffectiveWeightKg(weightKg, heightCm, widthCm, lengthCm);

      console.log(`[Pricing calculate] Processing ${item.item_id}: price=${price}, weight_kg=${weightKg}, effective_kg=${effectiveWeightKg}, listing_type_id=${item.listing_type_id}, category_id=${item.category_id}`);

      if (price <= 0) {
        results.push({
          item_id: item.item_id,
          variation_id: item.variation_id ?? null,
          price: 0,
          fee: 0,
          shipping_cost: 0,
          net_amount: 0,
        });
        continue;
      }

      if (!item.category_id) {
        console.warn(`[Pricing calculate] No category_id for ${item.item_id}, skipping fee calculation`);
        results.push({
          item_id: item.item_id,
          variation_id: item.variation_id ?? null,
          price,
          fee: 0,
          shipping_cost: getShippingCost(effectiveWeightKg, price),
          net_amount: price - getShippingCost(effectiveWeightKg, price),
        });
        continue;
      }

      const feeResult = await fetchSaleFee(accessToken, siteId, item.listing_type_id, price, item.category_id);

      if (!feeResult) {
        console.warn(`[Pricing calculate] No fee result for ${item.item_id}, listing_type_id=${item.listing_type_id}, category_id=${item.category_id}, price=${price}`);
      }

      const fee = feeResult?.fee ?? 0;

      const shippingCost = getShippingCost(effectiveWeightKg, price);

      const netAmount = Math.round((price - fee - shippingCost) * 100) / 100;

      results.push({
        item_id: item.item_id,
        variation_id: item.variation_id ?? null,
        price,
        fee,
        shipping_cost: shippingCost,
        net_amount: netAmount,
      });
    } catch (e) {
      console.error(`[Pricing calculate] error for ${item.item_id}:`, e);
      errors.push({
        item_id: item.item_id,
        variation_id: item.variation_id ?? null,
        error: "Erro ao calcular",
      });
    }
  }

  // Persistir resultados no cache para consulta rápida e filtros de lucratividade
  const now = new Date().toISOString();
  const serviceSupabase = createServiceClient();
  for (const item of results) {
    const variationId = item.variation_id ?? -1;
    await serviceSupabase
      .from("pricing_cache")
      .update({
        calculated_price: item.price,
        calculated_fee: item.fee,
        calculated_shipping_cost: item.shipping_cost,
        calculated_at: now,
      })
      .eq("account_id", account.id)
      .eq("item_id", item.item_id)
      .eq("variation_id", variationId);
  }

  return NextResponse.json({
    results,
    errors,
    is_mercado_lider: isMercadoLider,
  });
}
