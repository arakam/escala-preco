import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  parseHasPmaParam,
} from "@/lib/product-filters";
import {
  applyPricingListingIdFilters,
  fetchPricingCacheRowsByIdBatches,
  resolvePricingListingIdFilters,
} from "@/lib/pricing/resolve-listing-filters";
import { sortPricingCacheRows } from "@/lib/pricing/sort-pricing-cache-rows";
import {
  fetchAllViaRange,
  fetchAllViaRangeParallel,
  isAllPageSize,
  SUPABASE_RANGE_BATCH,
} from "@/lib/table-pagination";
import {
  parseStockCompareFilter,
  parseStockCompareFilterDecimal,
} from "@/lib/mercadolivre/item-tags";
import { applyNumericCompareFilter } from "@/lib/pricing/listings-query-filters";
import { attachProductPmaToRows } from "@/lib/pricing/attach-product-pma";
import { NextRequest, NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CacheQuery = any;

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
  /** PMA (R$) do produto vinculado — piso da promoção na tela de preços */
  pma?: number | null;
}

/** Colunas necessárias na listagem (evita select * e reduz payload em "Todos"). */
const PRICING_CACHE_LIST_COLUMNS =
  "id,account_id,item_id,variation_id,title,thumbnail,permalink,status,listing_type_id,category_id," +
  "current_price,sku,product_id,cost_price,weight_kg,height_cm,width_cm,length_cm," +
  "tax_percent,extra_fee_percent,fixed_expenses,planned_price,calculated_price,calculated_fee," +
  "calculated_shipping_cost,calculated_at,reference_fee_percent,ml_active_promotions,sales_30d,orders_30d";

const PRICE_REF_SELECT =
  "item_id, variation_id, status, suggested_price, min_reference_price, max_reference_price, explanation, updated_at";

function mapPriceRefRow(ref: Record<string, unknown>): {
  key: string;
  value: {
    status: string;
    suggested_price: number | null;
    min_reference_price: number | null;
    max_reference_price: number | null;
    explanation: string | null;
    updated_at: string | null;
  };
} {
  const itemId = String(ref.item_id).trim().toUpperCase();
  const vid = ref.variation_id == null ? "item" : String(ref.variation_id);
  return {
    key: `${itemId}:${vid}`,
    value: {
      status: ref.status as string,
      suggested_price: ref.suggested_price != null ? Number(ref.suggested_price) : null,
      min_reference_price: ref.min_reference_price != null ? Number(ref.min_reference_price) : null,
      max_reference_price: ref.max_reference_price != null ? Number(ref.max_reference_price) : null,
      explanation: (ref.explanation as string | null) ?? null,
      updated_at: (ref.updated_at as string | null) ?? null,
    },
  };
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
  const orders30dFilter = parseStockCompareFilter(
    url.searchParams.get("orders_30d_op") ?? "",
    url.searchParams.get("orders_30d_qty") ?? ""
  );
  const costFilter = parseStockCompareFilterDecimal(
    url.searchParams.get("cost_op") ?? "",
    url.searchParams.get("cost_qty") ?? ""
  );
  const discountFilter = parseStockCompareFilterDecimal(
    url.searchParams.get("discount_op") ?? "",
    url.searchParams.get("discount_qty") ?? ""
  );
  const profitFilter = parseStockCompareFilterDecimal(
    url.searchParams.get("profit_op") ?? "",
    url.searchParams.get("profit_qty") ?? ""
  );
  const semPromoMlAtiva = url.searchParams.get("sem_promo_ml") === "1";
  const fullOnly =
    url.searchParams.get("full_only") === "1" || url.searchParams.get("full_only") === "true";
  const tagIdsParam = url.searchParams.get("tags")?.trim() || "";
  const tagIds = tagIdsParam
    ? tagIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const hasPmaFilter = parseHasPmaParam(url.searchParams.get("has_pma"));

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

  /** Produto efetivo no cache (product_id) ou item_id (tag isolada) + Full. */
  let listingIdFilters: Awaited<ReturnType<typeof resolvePricingListingIdFilters>> | null = null;
  try {
    listingIdFilters = await resolvePricingListingIdFilters(serviceSupabase, account.id, user.id, {
      tagIds,
      supplierFilter,
      hasPma: hasPmaFilter,
      fullOnly,
    });
    if (
      listingIdFilters.allowedProductIds?.length === 0 ||
      listingIdFilters.allowedItemIds?.length === 0
    ) {
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

  try {
    const applyNonIdCacheFilters = (
      base: CacheQuery,
      options?: { count?: "exact" | undefined; columns?: string }
    ) => {
      const columns = options?.columns ?? PRICING_CACHE_LIST_COLUMNS;
      let q =
        options?.count === "exact"
          ? base.select(columns, { count: "exact" })
          : base.select(columns);
      q = q.eq("account_id", account.id);
      if (statusFilter) q = q.eq("status", statusFilter);
      if (linkedParam === "1") q = q.not("product_id", "is", null);
      else if (linkedParam === "0") q = q.is("product_id", null);
      if (search) q = q.or(`title.ilike.%${search}%,item_id.ilike.%${search}%`);
      if (skuFilter) q = q.ilike("sku", `%${skuFilter}%`);
      if (onlyWithSales30d) q = q.gt("orders_30d", 0);
      if (orders30dFilter) {
        q = applyNumericCompareFilter(q, "orders_30d", orders30dFilter.op, orders30dFilter.qty);
      }
      if (costFilter) {
        q = q.not("cost_price", "is", null);
        q = applyNumericCompareFilter(q, "cost_price", costFilter.op, costFilter.qty);
      }
      if (discountFilter) {
        q = q.not("discount_percent", "is", null);
        q = applyNumericCompareFilter(q, "discount_percent", discountFilter.op, discountFilter.qty);
      }
      if (profitFilter) {
        q = q.not("profit_margin_percent", "is", null);
        q = applyNumericCompareFilter(q, "profit_margin_percent", profitFilter.op, profitFilter.qty);
      }
      if (semPromoMlAtiva) {
        q = q.or("ml_active_promotions.is.null,ml_active_promotions.eq.");
      }
      return q;
    };

    const buildCacheQuery = (base: CacheQuery) => {
      let q = applyNonIdCacheFilters(base, { count: "exact" });
      if (listingIdFilters) {
        const withIds = applyPricingListingIdFilters(q, listingIdFilters);
        if (withIds) q = withIds;
      }
      return q;
    };

    const mustBatchIdFilters =
      listingIdFilters != null &&
      applyPricingListingIdFilters(
        serviceSupabase.from("pricing_cache").select("id"),
        listingIdFilters
      ) === null;

    const buildOrderedCacheQuery = () => {
      let q = buildCacheQuery(serviceSupabase.from("pricing_cache"));
      if (orderBy === "orders_desc") q = q.order("orders_30d", { ascending: false });
      else if (orderBy === "orders_asc") q = q.order("orders_30d", { ascending: true });
      else if (orderBy === "cost_desc") {
        q = q.order("cost_price", { ascending: false, nullsFirst: true });
      } else if (orderBy === "cost_asc") {
        q = q.order("cost_price", { ascending: true, nullsFirst: true });
      } else if (orderBy === "profit_desc") {
        q = q.order("profit_margin_percent", { ascending: false, nullsFirst: true });
      } else if (orderBy === "profit_asc") {
        q = q.order("profit_margin_percent", { ascending: true, nullsFirst: true });
      } else q = q.order("sort_title", { ascending: true });
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

    if (mustBatchIdFilters && listingIdFilters) {
      const { rows: allRows, error: batchErr } = await fetchPricingCacheRowsByIdBatches<
        Record<string, unknown>
      >(
        (idColumn, batch) => {
          let q = applyNonIdCacheFilters(serviceSupabase.from("pricing_cache"));
          return q.in(idColumn, batch);
        },
        listingIdFilters,
        PRICING_CACHE_LIST_COLUMNS
      );
      cacheErr = batchErr;
      if (!batchErr) {
        const sorted = sortPricingCacheRows(allRows, orderBy);
        totalCount = sorted.length;
        cacheRows = showAll ? sorted : sorted.slice(offset, offset + limit);
      }
    } else if (needsBatchFetch) {
      const maxRows = showAll ? undefined : offset + limit;
      const fetchAll = showAll ? fetchAllViaRangeParallel : fetchAllViaRange;
      const batchResult = await fetchAll<Record<string, unknown>>(
        async (from, to) => {
          const result = await buildOrderedCacheQuery().range(from, to);
          return {
            data: (result.data ?? []) as unknown as Record<string, unknown>[],
            error: result.error,
            count: result.count,
          };
        },
        showAll ? { maxRows, concurrency: 4 } : maxRows != null ? { maxRows } : undefined
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
      if (r.reference_fee_percent != null) {
        row.reference_fee_percent = Number(r.reference_fee_percent);
      }
      return row;
    });

    const listingsWithPma = await attachProductPmaToRows(serviceSupabase, listings, {
      userId: user.id,
    });

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

    if (showAll) {
      const refResult = await fetchAllViaRangeParallel<Record<string, unknown>>(
        async (from, to) => {
          const result = await serviceSupabase
            .from("price_references")
            .select(PRICE_REF_SELECT)
            .eq("account_id", account.id)
            .order("item_id", { ascending: true })
            .range(from, to);
          return {
            data: (result.data ?? []) as unknown as Record<string, unknown>[],
            error: result.error,
            count: result.count,
          };
        },
        { concurrency: 4 }
      );
      if (!refResult.error) {
        for (const ref of refResult.rows) {
          const { key, value } = mapPriceRefRow(ref);
          priceRefsMap[key] = value;
        }
      }
    } else {
      const uniqueItemIds = Array.from(
        new Set(listingsWithPma.map((l) => String(l.item_id).trim().toUpperCase()))
      );
      const REF_BATCH = 500;
      for (let i = 0; i < uniqueItemIds.length; i += REF_BATCH) {
        const batch = uniqueItemIds.slice(i, i + REF_BATCH);
        if (batch.length === 0) continue;
        const { data: refRows } = await serviceSupabase
          .from("price_references")
          .select(PRICE_REF_SELECT)
          .eq("account_id", account.id)
          .in("item_id", batch);
        for (const ref of refRows ?? []) {
          const { key, value } = mapPriceRefRow(ref as Record<string, unknown>);
          priceRefsMap[key] = value;
        }
      }
    }

    return NextResponse.json({
      listings: listingsWithPma,
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