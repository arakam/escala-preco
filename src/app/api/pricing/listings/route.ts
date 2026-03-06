import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "@/lib/mercadolivre/refresh";
import { getSalesMap } from "@/lib/mercadolivre/sales";

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
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
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
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const search = url.searchParams.get("search")?.trim() || "";
  const statusFilter = url.searchParams.get("status")?.trim() || "";
  const linkedOnly = url.searchParams.get("linked") === "1";
  const orderBy = url.searchParams.get("order_by")?.trim() || "";
  const orderBySales = orderBy === "sales_desc" || orderBy === "sales_asc";
  const skuFilter = url.searchParams.get("sku")?.trim() || "";

  const offset = (page - 1) * limit;
  const MAX_COMBINED_IDS = 15000;

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id,ml_user_id")
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
    if (orderBySales) {
      const sellerId = account.ml_user_id;
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
      const now = new Date();
      const to = new Date(now);
      const from = new Date(now);
      from.setDate(from.getDate() - 30);
      const dateFrom = from.toISOString().replace(/\.\d{3}/, ".000");
      const dateTo = to.toISOString().replace(/\.\d{3}/, ".999");

      let allItemsQuery = adminSupabase
        .from("ml_items")
        .select(
          `
            id,
            item_id,
            product_id,
            products:product_id (
              sku
            )
          `
        )
        .eq("account_id", account.id)
        .eq("has_variations", false);
      if (statusFilter) allItemsQuery = allItemsQuery.eq("status", statusFilter);
      if (linkedOnly) allItemsQuery = allItemsQuery.not("product_id", "is", null);
      if (search) allItemsQuery = allItemsQuery.or(`title.ilike.%${search}%,item_id.ilike.%${search}%`);
      if (skuFilter) {
        allItemsQuery = allItemsQuery.ilike("products.sku", `%${skuFilter}%`);
      }
      const { data: allItemsData, error: allItemsErr } = await allItemsQuery.order("title", { ascending: true });
      if (allItemsErr) {
        console.error("[Pricing listings] order_by sales items error:", allItemsErr);
        return NextResponse.json({ error: "Erro ao buscar anúncios" }, { status: 500 });
      }
      const simpleList = (allItemsData || []).map((i) => ({ id: i.id, item_id: i.item_id, variation_id: null as number | null, source: "item" as const }));

      let allVarsQuery = adminSupabase
        .from("ml_variations")
        .select(
          `
            id,
            item_id,
            variation_id,
            product_id,
            products:product_id (
              sku
            )
          `
        )
        .eq("account_id", account.id);
      if (linkedOnly) allVarsQuery = allVarsQuery.not("product_id", "is", null);
      if (skuFilter) {
        allVarsQuery = allVarsQuery.ilike("products.sku", `%${skuFilter}%`);
      }
      const { data: allVarsData, error: allVarsErr } = await allVarsQuery.order("item_id", { ascending: true });
      if (allVarsErr) {
        console.error("[Pricing listings] order_by sales variations error:", allVarsErr);
        return NextResponse.json({ error: "Erro ao buscar anúncios" }, { status: 500 });
      }
      const varItemIds = Array.from(new Set((allVarsData || []).map((v) => v.item_id)));
      let filteredVars = allVarsData || [];
      if (varItemIds.length > 0 && (statusFilter || search)) {
        const { data: parentItems } = await adminSupabase
          .from("ml_items")
          .select("item_id, status, title")
          .eq("account_id", account.id)
          .in("item_id", varItemIds);
        const parentMap = new Map((parentItems || []).map((p) => [p.item_id, p]));
        filteredVars = filteredVars.filter((v) => {
          const parent = parentMap.get(v.item_id);
          if (!parent) return false;
          if (statusFilter && parent.status !== statusFilter) return false;
          if (search && !(parent.title || "").toLowerCase().includes(search.toLowerCase()) && !v.item_id.toLowerCase().includes(search.toLowerCase())) return false;
          return true;
        });
      }
      const varList = filteredVars.map((v) => ({ id: v.id, item_id: v.item_id, variation_id: v.variation_id, source: "variation" as const }));
      const combined = [...simpleList, ...varList];
      const allItemIds = Array.from(new Set(combined.map((c) => c.item_id)));
      const { sales: salesMap, orders: ordersMap } = await getSalesMap(accessToken, sellerId, allItemIds, dateFrom, dateTo);
      combined.sort((a, b) => {
        const sa = salesMap[a.item_id] ?? 0;
        const sb = salesMap[b.item_id] ?? 0;
        return orderBy === "sales_desc" ? sb - sa : sa - sb;
      });
      const totalCount = combined.length;
      const pageList = combined.slice(offset, offset + limit);

      const itemIdsPage = pageList.filter((p) => p.source === "item").map((p) => p.id);
      const variationIdsPage = pageList.filter((p) => p.source === "variation").map((p) => p.id);

      const fullListings: PricingListingRow[] = [];
      const buildRowFromItem = (item: Record<string, unknown>): PricingListingRow => {
        const rawProduct = item.products as Record<string, unknown> | Record<string, unknown>[] | null;
        let productCostPrice: number | null = null;
        let productWeight: number | null = null;
        let productHeight: number | null = null;
        let productWidth: number | null = null;
        let productLength: number | null = null;
        let productSku: string | null = null;
        let productTaxPercent: number | null = null;
        let productExtraFeePercent: number | null = null;
        let productFixedExpenses: number | null = null;
        if (rawProduct) {
          const prod = Array.isArray(rawProduct) ? rawProduct[0] : rawProduct;
          if (prod) {
            productCostPrice = prod.cost_price != null ? Number(prod.cost_price) : null;
            productWeight = prod.weight != null ? Number(prod.weight) : null;
            productHeight = prod.height != null ? Number(prod.height) : null;
            productWidth = prod.width != null ? Number(prod.width) : null;
            productLength = prod.length != null ? Number(prod.length) : null;
            productSku = prod.sku != null ? String(prod.sku) : null;
            productTaxPercent = prod.tax_percent != null ? Number(prod.tax_percent) : null;
            productExtraFeePercent = prod.extra_fee_percent != null ? Number(prod.extra_fee_percent) : null;
            productFixedExpenses = prod.fixed_expenses != null ? Number(prod.fixed_expenses) : null;
          }
        }
        const rawJson = item.raw_json as Record<string, unknown> | null;
        let sku: string | null = null;
        if (rawJson?.attributes && Array.isArray(rawJson.attributes)) {
          const skuAttr = rawJson.attributes.find((a: { id?: string }) => a.id === "SELLER_SKU");
          if (skuAttr && typeof (skuAttr as { value_name?: string }).value_name === "string") sku = (skuAttr as { value_name: string }).value_name;
        }
        if (!sku && rawJson?.seller_custom_field) sku = String(rawJson.seller_custom_field);
        if (!sku && productSku) sku = productSku;
        return {
          id: item.id as string,
          item_id: item.item_id as string,
          variation_id: null,
          title: item.title as string | null,
          thumbnail: item.thumbnail as string | null,
          permalink: item.permalink as string | null,
          status: item.status as string | null,
          listing_type_id: item.listing_type_id as string | null,
          category_id: item.category_id as string | null,
          current_price: (item.price as number) ?? 0,
          sku,
          product_id: item.product_id as string | null,
          cost_price: productCostPrice,
          weight_kg: productWeight,
          height_cm: productHeight,
          width_cm: productWidth,
          length_cm: productLength,
          tax_percent: productTaxPercent,
          extra_fee_percent: productExtraFeePercent,
          fixed_expenses: productFixedExpenses,
          account_id: item.account_id as string,
        };
      };

      let itemsById = new Map<string, Record<string, unknown>>();
      if (itemIdsPage.length > 0) {
        const { data: itemsPageData } = await adminSupabase
          .from("ml_items")
          .select(`
            id, item_id, title, thumbnail, permalink, status, listing_type_id, category_id, price, raw_json, product_id, account_id,
            products:product_id (id, sku, cost_price, weight, height, width, length, tax_percent, extra_fee_percent, fixed_expenses)
          `)
          .in("id", itemIdsPage);
        itemsById = new Map((itemsPageData || []).map((i) => [i.id, i as unknown as Record<string, unknown>]));
      }

      let variationRowsByPageId = new Map<string, { variation: Record<string, unknown>; mlItem: Record<string, unknown> | null }>();
      if (variationIdsPage.length > 0) {
        const { data: varsPageData } = await adminSupabase
          .from("ml_variations")
          .select(`
            id, item_id, variation_id, price, raw_json, product_id, account_id,
            products:product_id (id, sku, cost_price, weight, height, width, length, tax_percent, extra_fee_percent, fixed_expenses)
          `)
          .in("id", variationIdsPage);
        const varItemIdsPage = Array.from(new Set((varsPageData || []).map((v) => v.item_id)));
        const { data: parentItems } = await adminSupabase
          .from("ml_items")
          .select("item_id, title, thumbnail, permalink, status, listing_type_id, category_id")
          .eq("account_id", account.id)
          .in("item_id", varItemIdsPage);
        const parentMap = new Map((parentItems || []).map((i) => [i.item_id, i as unknown as Record<string, unknown>]));
        for (const v of varsPageData || []) {
          const variation = v as unknown as Record<string, unknown>;
          variationRowsByPageId.set(variation.id as string, { variation, mlItem: parentMap.get(variation.item_id as string) ?? null });
        }
      }

      for (const p of pageList) {
        if (p.source === "item") {
          const item = itemsById.get(p.id);
          if (item) fullListings.push(buildRowFromItem(item));
          continue;
        }
        const row = variationRowsByPageId.get(p.id);
        if (!row) continue;
        const { variation, mlItem } = row;
        const rawProduct = variation.products as Record<string, unknown> | Record<string, unknown>[] | null;
        let productCostPrice: number | null = null;
        let productWeight: number | null = null;
        let productHeight: number | null = null;
        let productWidth: number | null = null;
        let productLength: number | null = null;
        let productSku: string | null = null;
        let productTaxPercent: number | null = null;
        let productExtraFeePercent: number | null = null;
        let productFixedExpenses: number | null = null;
        if (rawProduct) {
          const prod = Array.isArray(rawProduct) ? rawProduct[0] : rawProduct;
          if (prod) {
            productCostPrice = prod.cost_price != null ? Number(prod.cost_price) : null;
            productWeight = prod.weight != null ? Number(prod.weight) : null;
            productHeight = prod.height != null ? Number(prod.height) : null;
            productWidth = prod.width != null ? Number(prod.width) : null;
            productLength = prod.length != null ? Number(prod.length) : null;
            productSku = prod.sku != null ? String(prod.sku) : null;
            productTaxPercent = prod.tax_percent != null ? Number(prod.tax_percent) : null;
            productExtraFeePercent = prod.extra_fee_percent != null ? Number(prod.extra_fee_percent) : null;
            productFixedExpenses = prod.fixed_expenses != null ? Number(prod.fixed_expenses) : null;
          }
        }
        const rawJson = variation.raw_json as Record<string, unknown> | null;
        let sku: string | null = null;
        if (rawJson?.attributes && Array.isArray(rawJson.attributes)) {
          const skuAttr = rawJson.attributes.find((a: { id?: string }) => a.id === "SELLER_SKU");
          if (skuAttr && typeof (skuAttr as { value_name?: string }).value_name === "string") sku = (skuAttr as { value_name: string }).value_name;
        }
        if (!sku && rawJson?.seller_custom_field) sku = String(rawJson.seller_custom_field);
        if (!sku && productSku) sku = productSku;
        let variationName = "";
        if (rawJson?.attribute_combinations && Array.isArray(rawJson.attribute_combinations)) {
          variationName = rawJson.attribute_combinations.map((a: { value_name?: string }) => a.value_name || "").filter(Boolean).join(" / ");
        }
        const title: string | null =
          (mlItem?.title as string | null | undefined) ?? null;
        const thumbnail: string | null =
          (mlItem?.thumbnail as string | null | undefined) ?? null;
        const permalink: string | null =
          (mlItem?.permalink as string | null | undefined) ?? null;
        const status: string | null =
          (mlItem?.status as string | null | undefined) ?? null;
        const listingTypeId: string | null =
          (mlItem?.listing_type_id as string | null | undefined) ?? null;
        const categoryId: string | null =
          (mlItem?.category_id as string | null | undefined) ?? null;

        fullListings.push({
          id: variation.id as string,
          item_id: variation.item_id as string,
          variation_id: variation.variation_id as number,
          title: variationName ? `${title || ""} - ${variationName}` : title,
          thumbnail,
          permalink,
          status,
          listing_type_id: listingTypeId,
          category_id: categoryId,
          current_price: (variation.price as number) ?? 0,
          sku,
          product_id: variation.product_id as string | null,
          cost_price: productCostPrice,
          weight_kg: productWeight,
          height_cm: productHeight,
          width_cm: productWidth,
          length_cm: productLength,
          tax_percent: productTaxPercent,
          extra_fee_percent: productExtraFeePercent,
          fixed_expenses: productFixedExpenses,
          account_id: variation.account_id as string,
        });
      }

      return NextResponse.json({
        listings: fullListings,
        total: totalCount,
        page,
        limit,
        sales: salesMap,
        orders: ordersMap,
      });
    }

    // Busca geral: lista combinada (itens + variações) com filtros, depois paginar
    type RowRef = { type: "item"; id: string; sortTitle: string } | { type: "variation"; id: string; sortTitle: string; item_id: string };

    let itemsIdQuery = adminSupabase
      .from("ml_items")
      .select(skuFilter ? "id, title, products:product_id(sku)" : "id, title")
      .eq("account_id", account.id)
      .eq("has_variations", false);
    if (statusFilter) itemsIdQuery = itemsIdQuery.eq("status", statusFilter);
    if (linkedOnly) itemsIdQuery = itemsIdQuery.not("product_id", "is", null);
    if (search) itemsIdQuery = itemsIdQuery.or(`title.ilike.%${search}%,item_id.ilike.%${search}%`);
    if (skuFilter) itemsIdQuery = itemsIdQuery.ilike("products.sku", `%${skuFilter}%`);

    const { data: itemsIdData, error: itemsIdErr } = await itemsIdQuery
      .order("title", { ascending: true })
      .range(0, MAX_COMBINED_IDS - 1);

    if (itemsIdErr) {
      console.error("[Pricing listings] items ids error:", itemsIdErr);
      return NextResponse.json({ error: "Erro ao buscar anúncios" }, { status: 500 });
    }

    type ItemIdRow = { id: string; title?: string | null };
    const itemRefs: RowRef[] = ((itemsIdData || []) as unknown as ItemIdRow[]).map((i) => ({
      type: "item" as const,
      id: i.id,
      sortTitle: (i.title || "").toLowerCase(),
    }));

    let variationsIdQuery = adminSupabase
      .from("ml_variations")
      .select(skuFilter ? "id, item_id, products:product_id(sku)" : "id, item_id")
      .eq("account_id", account.id);
    if (linkedOnly) variationsIdQuery = variationsIdQuery.not("product_id", "is", null);
    if (skuFilter) variationsIdQuery = variationsIdQuery.ilike("products.sku", `%${skuFilter}%`);

    const { data: variationsIdData, error: variationsIdErr } = await variationsIdQuery
      .order("item_id", { ascending: true })
      .range(0, MAX_COMBINED_IDS - 1);

    if (variationsIdErr) {
      console.error("[Pricing listings] variations ids error:", variationsIdErr);
    }

    type VariationIdRow = { id: string; item_id: string };
    const variationsRows = (variationsIdData || []) as unknown as VariationIdRow[];
    const varItemIds = Array.from(new Set(variationsRows.map((v) => v.item_id)));
    let variationRefs: RowRef[] = [];
    if (varItemIds.length > 0) {
      const { data: parentItems } = await adminSupabase
        .from("ml_items")
        .select("item_id, title, status")
        .eq("account_id", account.id)
        .in("item_id", varItemIds);
      const parentMap = new Map((parentItems || []).map((p) => [p.item_id, p]));
      variationRefs = variationsRows
        .filter((v) => {
          const p = parentMap.get(v.item_id);
          if (!p) return false;
          if (statusFilter && p.status !== statusFilter) return false;
          if (search) {
            const title = (p.title || "").toLowerCase();
            const match = title.includes(search.toLowerCase()) || v.item_id.toLowerCase().includes(search.toLowerCase());
            if (!match) return false;
          }
          return true;
        })
        .map((v) => {
          const p = parentMap.get(v.item_id);
          return { type: "variation" as const, id: v.id, sortTitle: (p?.title || "").toLowerCase(), item_id: v.item_id };
        });
    }

    const combined: RowRef[] = [...itemRefs, ...variationRefs].sort((a, b) => {
      const c = a.sortTitle.localeCompare(b.sortTitle, "pt-BR");
      if (c !== 0) return c;
      return a.id.localeCompare(b.id);
    });
    const totalCount = combined.length;
    const pageRefs = combined.slice(offset, offset + limit);
    const itemIdsPage = pageRefs.filter((r): r is RowRef & { type: "item" } => r.type === "item").map((r) => r.id);
    const variationIdsPage = pageRefs.filter((r): r is RowRef & { type: "variation" } => r.type === "variation").map((r) => r.id);

    const listings: PricingListingRow[] = [];

    const buildItemRow = (item: Record<string, unknown>): PricingListingRow => {
      const rawProduct = item.products as Record<string, unknown> | Record<string, unknown>[] | null;
      let productCostPrice: number | null = null;
      let productWeight: number | null = null;
      let productHeight: number | null = null;
      let productWidth: number | null = null;
      let productLength: number | null = null;
      let productSku: string | null = null;
      let productTaxPercent: number | null = null;
      let productExtraFeePercent: number | null = null;
      let productFixedExpenses: number | null = null;
      if (rawProduct) {
        const prod = Array.isArray(rawProduct) ? rawProduct[0] : rawProduct;
        if (prod) {
          productCostPrice = prod.cost_price != null ? Number(prod.cost_price) : null;
          productWeight = prod.weight != null ? Number(prod.weight) : null;
          productHeight = prod.height != null ? Number(prod.height) : null;
          productWidth = prod.width != null ? Number(prod.width) : null;
          productLength = prod.length != null ? Number(prod.length) : null;
          productSku = prod.sku != null ? String(prod.sku) : null;
          productTaxPercent = prod.tax_percent != null ? Number(prod.tax_percent) : null;
          productExtraFeePercent = prod.extra_fee_percent != null ? Number(prod.extra_fee_percent) : null;
          productFixedExpenses = prod.fixed_expenses != null ? Number(prod.fixed_expenses) : null;
        }
      }
      const rawJson = item.raw_json as Record<string, unknown> | null;
      let sku: string | null = null;
      if (rawJson?.attributes && Array.isArray(rawJson.attributes)) {
        const skuAttr = rawJson.attributes.find((a: { id?: string }) => a.id === "SELLER_SKU");
        if (skuAttr && typeof (skuAttr as { value_name?: string }).value_name === "string") sku = (skuAttr as { value_name: string }).value_name;
      }
      if (!sku && rawJson?.seller_custom_field) sku = String(rawJson.seller_custom_field);
      if (!sku && productSku) sku = productSku;
      return {
        id: item.id as string,
        item_id: item.item_id as string,
        variation_id: null,
        title: item.title as string | null,
        thumbnail: item.thumbnail as string | null,
        permalink: item.permalink as string | null,
        status: item.status as string | null,
        listing_type_id: item.listing_type_id as string | null,
        category_id: item.category_id as string | null,
        current_price: (item.price as number) ?? 0,
        sku,
        product_id: item.product_id as string | null,
        cost_price: productCostPrice,
        weight_kg: productWeight,
        height_cm: productHeight,
        width_cm: productWidth,
        length_cm: productLength,
        tax_percent: productTaxPercent,
        extra_fee_percent: productExtraFeePercent,
        fixed_expenses: productFixedExpenses,
        account_id: item.account_id as string,
      };
    };

    if (itemIdsPage.length > 0) {
      const { data: itemsPageData } = await adminSupabase
        .from("ml_items")
        .select(`
          id, item_id, title, thumbnail, permalink, status, listing_type_id, category_id, price, raw_json, product_id, account_id,
          products:product_id (id, sku, cost_price, weight, height, width, length, tax_percent, extra_fee_percent, fixed_expenses)
        `)
        .eq("account_id", account.id)
        .in("id", itemIdsPage);
      const itemsById = new Map((itemsPageData || []).map((i) => [i.id, i as unknown as Record<string, unknown>]));
      for (const ref of pageRefs) {
        if (ref.type !== "item") continue;
        const item = itemsById.get(ref.id);
        if (item) listings.push(buildItemRow(item));
      }
    }

    if (variationIdsPage.length > 0) {
      const { data: varsPageData } = await adminSupabase
        .from("ml_variations")
        .select(`
          id, item_id, variation_id, price, raw_json, product_id, account_id,
          products:product_id (id, sku, cost_price, weight, height, width, length, tax_percent, extra_fee_percent, fixed_expenses)
        `)
        .in("id", variationIdsPage);
      const varItemIdsPage = Array.from(new Set((varsPageData || []).map((v) => v.item_id)));
      const { data: parentItems } = await adminSupabase
        .from("ml_items")
        .select("item_id, title, thumbnail, permalink, status, listing_type_id, category_id")
        .eq("account_id", account.id)
        .in("item_id", varItemIdsPage);
      const parentMap = new Map((parentItems || []).map((i) => [i.item_id, i as unknown as Record<string, unknown>]));
      const variationRowsById = new Map<string, { variation: Record<string, unknown>; mlItem: Record<string, unknown> | null }>();
      for (const v of varsPageData || []) {
        const variation = v as unknown as Record<string, unknown>;
        variationRowsById.set(variation.id as string, { variation, mlItem: parentMap.get(variation.item_id as string) ?? null });
      }
      for (const ref of pageRefs) {
        if (ref.type !== "variation") continue;
        const row = variationRowsById.get(ref.id);
        if (!row) continue;
        const { variation, mlItem } = row;
        const rawProduct = variation.products as Record<string, unknown> | Record<string, unknown>[] | null;
        let productCostPrice: number | null = null;
        let productWeight: number | null = null;
        let productHeight: number | null = null;
        let productWidth: number | null = null;
        let productLength: number | null = null;
        let productSku: string | null = null;
        let productTaxPercent: number | null = null;
        let productExtraFeePercent: number | null = null;
        let productFixedExpenses: number | null = null;
        if (rawProduct) {
          const prod = Array.isArray(rawProduct) ? rawProduct[0] : rawProduct;
          if (prod) {
            productCostPrice = prod.cost_price != null ? Number(prod.cost_price) : null;
            productWeight = prod.weight != null ? Number(prod.weight) : null;
            productHeight = prod.height != null ? Number(prod.height) : null;
            productWidth = prod.width != null ? Number(prod.width) : null;
            productLength = prod.length != null ? Number(prod.length) : null;
            productSku = prod.sku != null ? String(prod.sku) : null;
            productTaxPercent = prod.tax_percent != null ? Number(prod.tax_percent) : null;
            productExtraFeePercent = prod.extra_fee_percent != null ? Number(prod.extra_fee_percent) : null;
            productFixedExpenses = prod.fixed_expenses != null ? Number(prod.fixed_expenses) : null;
          }
        }
        const rawJson = variation.raw_json as Record<string, unknown> | null;
        let sku: string | null = null;
        if (rawJson?.attributes && Array.isArray(rawJson.attributes)) {
          const skuAttr = rawJson.attributes.find((a: { id?: string }) => a.id === "SELLER_SKU");
          if (skuAttr && typeof (skuAttr as { value_name?: string }).value_name === "string") sku = (skuAttr as { value_name: string }).value_name;
        }
        if (!sku && rawJson?.seller_custom_field) sku = String(rawJson.seller_custom_field);
        if (!sku && productSku) sku = productSku;
        let variationName = "";
        if (rawJson?.attribute_combinations && Array.isArray(rawJson.attribute_combinations)) {
          variationName = rawJson.attribute_combinations.map((a: { value_name?: string }) => a.value_name || "").filter(Boolean).join(" / ");
        }
        const title: string | null = (mlItem?.title as string | null | undefined) ?? null;
        listings.push({
          id: variation.id as string,
          item_id: variation.item_id as string,
          variation_id: variation.variation_id as number,
          title: variationName ? `${title || ""} - ${variationName}` : title,
          thumbnail: (mlItem?.thumbnail as string | null | undefined) ?? null,
          permalink: (mlItem?.permalink as string | null | undefined) ?? null,
          status: (mlItem?.status as string | null | undefined) ?? null,
          listing_type_id: (mlItem?.listing_type_id as string | null | undefined) ?? null,
          category_id: (mlItem?.category_id as string | null | undefined) ?? null,
          current_price: (variation.price as number) ?? 0,
          sku,
          product_id: variation.product_id as string | null,
          cost_price: productCostPrice,
          weight_kg: productWeight,
          height_cm: productHeight,
          width_cm: productWidth,
          length_cm: productLength,
          tax_percent: productTaxPercent,
          extra_fee_percent: productExtraFeePercent,
          fixed_expenses: productFixedExpenses,
          account_id: variation.account_id as string,
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
