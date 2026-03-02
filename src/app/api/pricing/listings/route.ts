import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export interface PricingListingRow {
  id: string;
  item_id: string;
  variation_id: number | null;
  title: string | null;
  thumbnail: string | null;
  permalink: string | null;
  status: string | null;
  listing_type_id: string | null;
  category_id: string | null;
  current_price: number;
  sku: string | null;
  product_id: string | null;
  cost_price: number | null;
  weight_kg: number | null;
  account_id: string;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const search = url.searchParams.get("search")?.trim() || "";
  const statusFilter = url.searchParams.get("status")?.trim() || "";
  const linkedOnly = url.searchParams.get("linked") === "1";

  const offset = (page - 1) * limit;

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id")
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

  try {
    const listings: PricingListingRow[] = [];
    let totalCount = 0;

    let itemsQuery = adminSupabase
      .from("ml_items")
      .select(`
        id,
        item_id,
        title,
        thumbnail,
        permalink,
        status,
        listing_type_id,
        category_id,
        price,
        has_variations,
        raw_json,
        product_id,
        account_id,
        products:product_id (
          id,
          sku,
          cost_price,
          weight
        )
      `, { count: "exact" })
      .eq("account_id", account.id)
      .eq("has_variations", false);

    if (statusFilter) {
      itemsQuery = itemsQuery.eq("status", statusFilter);
    }

    if (linkedOnly) {
      itemsQuery = itemsQuery.not("product_id", "is", null);
    }

    if (search) {
      itemsQuery = itemsQuery.or(`title.ilike.%${search}%,item_id.ilike.%${search}%`);
    }

    const { data: itemsData, error: itemsError, count: itemsCount } = await itemsQuery
      .order("title", { ascending: true })
      .range(offset, offset + limit - 1);

    if (itemsError) {
      console.error("[Pricing listings] items error:", itemsError);
      return NextResponse.json({ error: "Erro ao buscar anúncios" }, { status: 500 });
    }

    totalCount = itemsCount || 0;

    for (const item of itemsData || []) {
      const product = item.products as { id: string; sku: string; cost_price: number | null; weight: number | null } | null;
      const rawJson = item.raw_json as Record<string, unknown> | null;
      
      let sku: string | null = null;
      if (rawJson?.attributes && Array.isArray(rawJson.attributes)) {
        const skuAttr = rawJson.attributes.find((a: { id?: string }) => a.id === "SELLER_SKU");
        if (skuAttr && typeof (skuAttr as { value_name?: string }).value_name === "string") {
          sku = (skuAttr as { value_name: string }).value_name;
        }
      }
      if (!sku && rawJson?.seller_custom_field) {
        sku = String(rawJson.seller_custom_field);
      }
      if (!sku && product?.sku) {
        sku = product.sku;
      }

      listings.push({
        id: item.id,
        item_id: item.item_id,
        variation_id: null,
        title: item.title,
        thumbnail: item.thumbnail,
        permalink: item.permalink,
        status: item.status,
        listing_type_id: item.listing_type_id,
        category_id: item.category_id,
        current_price: item.price ?? 0,
        sku,
        product_id: item.product_id,
        cost_price: product?.cost_price ?? null,
        weight_kg: product?.weight ?? null,
        account_id: item.account_id,
      });
    }

    let variationsQuery = adminSupabase
      .from("ml_variations")
      .select(`
        id,
        item_id,
        variation_id,
        price,
        raw_json,
        product_id,
        account_id,
        products:product_id (
          id,
          sku,
          cost_price,
          weight
        )
      `, { count: "exact" })
      .eq("account_id", account.id);

    if (linkedOnly) {
      variationsQuery = variationsQuery.not("product_id", "is", null);
    }

    const { data: variationsData, error: variationsError } = await variationsQuery
      .order("item_id", { ascending: true })
      .range(0, limit - 1);

    if (variationsError) {
      console.error("[Pricing listings] variations error:", variationsError);
    }

    if (variationsData && variationsData.length > 0) {
      const itemIds = [...new Set(variationsData.map((v) => v.item_id))];
      const { data: parentItems } = await adminSupabase
        .from("ml_items")
        .select("item_id, title, thumbnail, permalink, status, listing_type_id, category_id")
        .eq("account_id", account.id)
        .in("item_id", itemIds);

      const itemsMap = new Map(
        (parentItems || []).map((item) => [item.item_id, item])
      );

      for (const variation of variationsData) {
        const product = variation.products as { id: string; sku: string; cost_price: number | null; weight: number | null } | null;
        const mlItem = itemsMap.get(variation.item_id);
        const rawJson = variation.raw_json as Record<string, unknown> | null;

        if (statusFilter && mlItem?.status !== statusFilter) {
          continue;
        }

        let sku: string | null = null;
        if (rawJson?.attributes && Array.isArray(rawJson.attributes)) {
          const skuAttr = rawJson.attributes.find((a: { id?: string }) => a.id === "SELLER_SKU");
          if (skuAttr && typeof (skuAttr as { value_name?: string }).value_name === "string") {
            sku = (skuAttr as { value_name: string }).value_name;
          }
        }
        if (!sku && rawJson?.seller_custom_field) {
          sku = String(rawJson.seller_custom_field);
        }
        if (!sku && product?.sku) {
          sku = product.sku;
        }

        let variationName = "";
        if (rawJson?.attribute_combinations && Array.isArray(rawJson.attribute_combinations)) {
          variationName = rawJson.attribute_combinations
            .map((a: { value_name?: string }) => a.value_name || "")
            .filter(Boolean)
            .join(" / ");
        }

        const title = mlItem?.title || null;
        if (search && title && !title.toLowerCase().includes(search.toLowerCase()) && !variation.item_id.toLowerCase().includes(search.toLowerCase())) {
          continue;
        }

        listings.push({
          id: variation.id,
          item_id: variation.item_id,
          variation_id: variation.variation_id,
          title: variationName ? `${title || ""} - ${variationName}` : title,
          thumbnail: mlItem?.thumbnail || null,
          permalink: mlItem?.permalink || null,
          status: mlItem?.status || null,
          listing_type_id: mlItem?.listing_type_id || null,
          category_id: mlItem?.category_id || null,
          current_price: variation.price ?? 0,
          sku,
          product_id: variation.product_id,
          cost_price: product?.cost_price ?? null,
          weight_kg: product?.weight ?? null,
          account_id: variation.account_id,
        });
      }
    }

    return NextResponse.json({
      listings,
      total: totalCount,
      page,
      limit,
    });
  } catch (e) {
    console.error("[Pricing listings] error:", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
