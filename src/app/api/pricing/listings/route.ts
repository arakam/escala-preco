import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
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
  /** Dados do último cálculo persistidos para consulta e filtros */
  planned_price?: number;
  calculated_price?: number | null;
  calculated_fee?: number | null;
  calculated_shipping_cost?: number | null;
  calculated_at?: string | null;
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
  const limit = Math.min(10000, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
  const search = url.searchParams.get("search")?.trim() || "";
  const statusFilter = url.searchParams.get("status")?.trim() || "";
  const linkedOnly = url.searchParams.get("linked") === "1";
  const orderBy = url.searchParams.get("order_by")?.trim() || "";
  const skuFilter = url.searchParams.get("sku")?.trim() || "";
  const onlyWithSales30d = url.searchParams.get("only_with_sales") === "1";

  const offset = (page - 1) * limit;

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

  try {
    const buildCacheQuery = (base: ReturnType<typeof serviceSupabase.from>) => {
      let q = base.select("*").eq("account_id", account.id);
      if (statusFilter) q = q.eq("status", statusFilter);
      if (linkedOnly) q = q.not("product_id", "is", null);
      if (search) q = q.or(`title.ilike.%${search}%,item_id.ilike.%${search}%`);
      if (skuFilter) q = q.ilike("sku", `%${skuFilter}%`);
      if (onlyWithSales30d) q = q.gt("sales_30d", 0);
      return q;
    };

    let dataQuery = buildCacheQuery(serviceSupabase.from("pricing_cache"));
    if (orderBy === "sales_desc") dataQuery = dataQuery.order("sales_30d", { ascending: false });
    else if (orderBy === "sales_asc") dataQuery = dataQuery.order("sales_30d", { ascending: true });
    else dataQuery = dataQuery.order("sort_title", { ascending: true });

    const { data: cacheRows, error: cacheErr, count: totalCount } = await dataQuery.range(
      offset,
      offset + limit - 1
    ).select("*", { count: "exact" });

    const { data: lastRow } = await serviceSupabase
      .from("pricing_cache")
      .select("cache_updated_at")
      .eq("account_id", account.id)
      .order("cache_updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastUpdatedAt = (lastRow?.cache_updated_at as string) ?? null;

    if (cacheErr) {
      console.error("[pricing/listings] cache error:", cacheErr);
      return NextResponse.json(
        {
          listings: [],
          total: 0,
          page,
          limit,
          sales: {},
          orders: {},
          last_updated_at: null,
          cache_empty: true,
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
        limit,
        sales: {},
        orders: {},
        last_updated_at: lastUpdatedAt,
        cache_empty: true,
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
      };
      const planned = Number(r.planned_price);
      if (!Number.isNaN(planned)) row.planned_price = planned;
      if (r.calculated_price != null) row.calculated_price = Number(r.calculated_price);
      if (r.calculated_fee != null) row.calculated_fee = Number(r.calculated_fee);
      if (r.calculated_shipping_cost != null) row.calculated_shipping_cost = Number(r.calculated_shipping_cost);
      if (r.calculated_at != null) row.calculated_at = r.calculated_at as string;
      return row;
    });

    return NextResponse.json({
      listings,
      total,
      page,
      limit,
      sales: salesMap,
      orders: ordersMap,
      last_updated_at: lastUpdatedAt,
      cache_empty: false,
    });
  } catch (e) {
    console.error("[Pricing listings] error:", e);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}