import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { intersectMlItemIdFilters, resolveMlItemIdsByProductSupplier } from "@/lib/product-filters";
import { resolveMlItemIdsByProductTagIds } from "@/lib/product-tags";
import {
  fetchAllViaRange,
  isAllPageSize,
  SUPABASE_RANGE_BATCH,
} from "@/lib/table-pagination";
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
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  account_id: string;
  /** Promoções ML ativas (uma linha por promoção); preenchido no refresh do cache */
  ml_active_promotions?: string | null;
  /** Dados do último cálculo persistidos para consulta e filtros */
  planned_price?: number;
  calculated_price?: number | null;
  calculated_fee?: number | null;
  calculated_shipping_cost?: number | null;
  calculated_at?: string | null;
  /** % taxa ML (fee/preço) por categoria+tipo — iteração rápida de margem */
  reference_fee_percent?: number | null;
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
  const limitParam = parseInt(url.searchParams.get("limit") || "50", 10);
  const showAll = isAllPageSize(limitParam);
  const page = showAll ? 1 : Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = showAll ? 0 : Math.min(10000, Math.max(1, limitParam));
  const fetchLimit = showAll ? 0 : limit;
  const search = url.searchParams.get("search")?.trim() || "";
  const statusFilter = url.searchParams.get("status")?.trim() || "";
  /** linked=1 só com produto; linked=0 só sem produto; omitido = todos */
  const linkedParam = url.searchParams.get("linked")?.trim();
  const orderBy = url.searchParams.get("order_by")?.trim() || "";
  const skuFilter = url.searchParams.get("sku")?.trim() || "";
  const supplierFilter = url.searchParams.get("supplier")?.trim() || "";
  const onlyWithSales30d = url.searchParams.get("only_with_sales") === "1";
  const tagIdsParam = url.searchParams.get("tags")?.trim() || "";
  const tagIds = tagIdsParam
    ? tagIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const offset = showAll ? 0 : (page - 1) * limit;

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id,ml_user_id")
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta ML não encontrada" }, { status: 404 });
  }

  // Ler cache com service role (já validamos que a conta é do usuário); evita RLS bloqueando leitura
  const serviceSupabase = createServiceClient();

  /** MLB com produto tagueado ou fornecedor (via ml_items/ml_variations), não só product_id no cache. */
  let allowedItemIds: string[] | null = null;
  if (tagIds.length > 0 || supplierFilter) {
    try {
      const byTags =
        tagIds.length > 0
          ? await resolveMlItemIdsByProductTagIds(serviceSupabase, account.id, tagIds)
          : null;
      const bySupplier = supplierFilter
        ? await resolveMlItemIdsByProductSupplier(
            serviceSupabase,
            account.id,
            user.id,
            supplierFilter
          )
        : null;
      allowedItemIds = intersectMlItemIdFilters(byTags, bySupplier);
      if (allowedItemIds !== null && allowedItemIds.length === 0) {
        return NextResponse.json({
          listings: [],
          total: 0,
          page,
          limit: fetchLimit,
          totalPages: 0,
          last_updated_at: null,
          linked_row_count: 0,
        });
      }
    } catch (e) {
      console.error("Erro ao filtrar listagens por produto:", e);
      return NextResponse.json({ error: "Erro ao filtrar por produto" }, { status: 500 });
    }
  }

  try {
    const buildCacheQuery = (base: ReturnType<typeof serviceSupabase.from>) => {
      let q = base.select("*", { count: "exact" }).eq("account_id", account.id);
      if (statusFilter) q = q.eq("status", statusFilter);
      if (linkedParam === "1") q = q.not("product_id", "is", null);
      else if (linkedParam === "0") q = q.is("product_id", null);
      if (search) q = q.or(`title.ilike.%${search}%,item_id.ilike.%${search}%`);
      if (skuFilter) q = q.ilike("sku", `%${skuFilter}%`);
      if (onlyWithSales30d) q = q.gt("orders_30d", 0);
      if (allowedItemIds) q = q.in("item_id", allowedItemIds);
      return q;
    };

    const buildOrderedCacheQuery = () => {
      let q = buildCacheQuery(serviceSupabase.from("pricing_cache"));
      if (orderBy === "orders_desc") q = q.order("orders_30d", { ascending: false });
      else if (orderBy === "orders_asc") q = q.order("orders_30d", { ascending: true });
      else q = q.order("sort_title", { ascending: true });
      return q;
    };

    const needsBatchFetch = showAll || limit > SUPABASE_RANGE_BATCH;

    const lastUpdatedPromise = serviceSupabase
      .from("pricing_cache")
      .select("cache_updated_at")
      .eq("account_id", account.id)
      .order("cache_updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    /** Conta global na conta (não só a página) — evita aviso enganoso de “vincule” quando o filtro é “só não vinculados”. */
    const linkedGlobalCountPromise = serviceSupabase
      .from("pricing_cache")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account.id)
      .not("product_id", "is", null);

    const [{ data: lastRow }, { count: linkedRowCount }] = await Promise.all([
      lastUpdatedPromise,
      linkedGlobalCountPromise,
    ]);

    let cacheRows: Array<Record<string, unknown>> | null = null;
    let cacheErr: unknown = null;
    let totalCount: number | null = null;

    if (needsBatchFetch) {
      const maxRows = showAll ? undefined : offset + limit;
      const batchResult = await fetchAllViaRange<Record<string, unknown>>(
        (from, to) => buildOrderedCacheQuery().range(from, to),
        maxRows != null ? { maxRows } : undefined
      );
      cacheErr = batchResult.error;
      totalCount = batchResult.total;
      cacheRows = showAll
        ? batchResult.rows
        : batchResult.rows.slice(offset, offset + limit);
    } else {
      const pageResult = await buildOrderedCacheQuery().range(
        offset,
        offset + limit - 1
      );
      cacheRows = pageResult.data as Array<Record<string, unknown>> | null;
      cacheErr = pageResult.error;
      totalCount = pageResult.count;
    }

    const lastUpdatedAt = (lastRow?.cache_updated_at as string) ?? null;
    const accountHasLinkedProducts = (linkedRowCount ?? 0) > 0;

    if (cacheErr) {
      console.error("[pricing/listings] cache error:", cacheErr);
      return NextResponse.json(
        {
          listings: [],
          total: 0,
          page,
          limit: fetchLimit,
          sales: {},
          orders: {},
          price_references: {},
          account_id: account.id,
          last_updated_at: null,
          cache_empty: true,
          account_has_linked_products: false,
        },
        { status: 200 }
      );
    }

    const total = totalCount ?? 0;
    const rows = (cacheRows ?? []) as Array<Record<string, unknown>>;

    if (rows.length === 0 && total === 0) {
      return NextResponse.json({
        listings: [],
        total: 0,
        page,
        limit: fetchLimit,
        sales: {},
        orders: {},
        price_references: {},
        account_id: account.id,
        last_updated_at: lastUpdatedAt,
        cache_empty: true,
        account_has_linked_products: accountHasLinkedProducts,
      });
    }

    const salesMap: Record<string, number> = {};
    const ordersMap: Record<string, number> = {};
    const listings = rows.map((r) => {
      const itemId = r.item_id as string;
      salesMap[itemId] = (r.sales_30d as number) ?? 0;
      ordersMap[itemId] = (r.orders_30d as number) ?? 0;
      const row: PricingListingRow = {
        id: r.id as string,
        item_id: itemId,
        variation_id: (r.variation_id as number) === -1 ? null : (r.variation_id as number),
        title: r.title as string | null,
        thumbnail: r.thumbnail as string | null,
        permalink: r.permalink as string | null,
        status: r.status as string | null,
        listing_type_id: r.listing_type_id as string | null,
        category_id: r.category_id as string | null,
        current_price: Number(r.current_price) ?? 0,
        sku: r.sku as string | null,
        product_id: r.product_id as string | null,
        cost_price: r.cost_price != null ? Number(r.cost_price) : null,
        weight_kg: r.weight_kg != null ? Number(r.weight_kg) : null,
        height_cm: r.height_cm != null ? Number(r.height_cm) : null,
        width_cm: r.width_cm != null ? Number(r.width_cm) : null,
        length_cm: r.length_cm != null ? Number(r.length_cm) : null,
        tax_percent: r.tax_percent != null ? Number(r.tax_percent) : null,
        extra_fee_percent: r.extra_fee_percent != null ? Number(r.extra_fee_percent) : null,
        fixed_expenses: r.fixed_expenses != null ? Number(r.fixed_expenses) : null,
        account_id: r.account_id as string,
        ml_active_promotions:
          typeof r.ml_active_promotions === "string" && r.ml_active_promotions.trim()
            ? r.ml_active_promotions
            : null,
      };
      const planned = Number(r.planned_price);
      if (!Number.isNaN(planned)) row.planned_price = planned;
      if (r.calculated_price != null) row.calculated_price = Number(r.calculated_price);
      if (r.calculated_fee != null) row.calculated_fee = Number(r.calculated_fee);
      if (r.calculated_shipping_cost != null) row.calculated_shipping_cost = Number(r.calculated_shipping_cost);
      if (r.calculated_at != null) row.calculated_at = r.calculated_at as string;
      return row;
    });

    const uniqueItemIds = Array.from(
      new Set(listings.map((l) => String(l.item_id).trim().toUpperCase()))
    );
    const priceRefsMap: Record<
      string,
      {
        status: string;
        suggested_price: number | null;
        min_reference_price: number | null;
        max_reference_price: number | null;
        explanation: string | null;
        updated_at: string | null;
      }
    > = {};
    const REF_BATCH = 100;
    for (let i = 0; i < uniqueItemIds.length; i += REF_BATCH) {
      const batch = uniqueItemIds.slice(i, i + REF_BATCH);
      if (batch.length === 0) continue;
      const { data: refRows } = await serviceSupabase
        .from("price_references")
        .select(
          "item_id, variation_id, status, suggested_price, min_reference_price, max_reference_price, explanation, updated_at"
        )
        .eq("account_id", account.id)
        .in("item_id", batch);
      for (const ref of refRows ?? []) {
        const r = ref as {
          item_id: string;
          variation_id: number | null;
          status: string;
          suggested_price: number | null;
          min_reference_price: number | null;
          max_reference_price: number | null;
          explanation: string | null;
          updated_at: string | null;
        };
        const vid = r.variation_id == null ? "item" : String(r.variation_id);
        const key = `${String(r.item_id).trim().toUpperCase()}:${vid}`;
        priceRefsMap[key] = {
          status: r.status,
          suggested_price: r.suggested_price != null ? Number(r.suggested_price) : null,
          min_reference_price: r.min_reference_price != null ? Number(r.min_reference_price) : null,
          max_reference_price: r.max_reference_price != null ? Number(r.max_reference_price) : null,
          explanation: r.explanation ?? null,
          updated_at: r.updated_at ?? null,
        };
      }
    }

    return NextResponse.json({
      listings,
      total,
      page,
      limit: fetchLimit,
      sales: salesMap,
      orders: ordersMap,
      price_references: priceRefsMap,
      account_id: account.id,
      last_updated_at: lastUpdatedAt,
      cache_empty: false,
      account_has_linked_products: accountHasLinkedProducts,
    });
  } catch (e) {
    console.error("[Pricing listings] error:", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}