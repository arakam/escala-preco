import { fetchAllWholesaleDraftsForAccount } from "@/lib/atacado-drafts";
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export interface DashboardSummaryResponse {
  account: { id: string; ml_user_id: number; ml_nickname: string | null };
  cards: {
    margin_avg_percent: number | null;
    margin_revenue_estimated: number;
    risk_count: number;
    competitiveness_percent: number;
    competitiveness: {
      competitive: number;
      attention: number;
      high: number;
      none: number;
      total: number;
    };
    coverage_percent: number;
    coverage_count: number;
    total_listings: number;
  };
  alerts: {
    no_cost: number;
    negative_margin: number;
    above_market: number;
    no_wholesale: number;
    no_sku_link: number;
  };
  insights: {
    top_sales: InsightRow[];
    top_margin: InsightRow[];
    top_risk: InsightRow[];
  };
}

interface InsightRow {
  item_id: string;
  variation_id: number | null;
  title: string | null;
  thumbnail: string | null;
  current_price: number;
  orders_30d: number;
  margin_percent: number | null;
  unit_profit: number | null;
  is_above_market: boolean;
  risk_status: "high" | "attention" | "ok";
  risk_reason: string | null;
}

/** Tier válido em rascunho: min_qty e price numéricos */
function hasValidTier(tiers: unknown): boolean {
  if (!Array.isArray(tiers) || tiers.length === 0) return false;
  return tiers.some(
    (t) =>
      t != null &&
      typeof t === "object" &&
      typeof (t as { min_qty?: unknown }).min_qty === "number" &&
      typeof (t as { price?: unknown }).price === "number"
  );
}

/** Tiers vindos do ML em `ml_items.wholesale_prices_json`: { min_purchase_unit, amount } */
function hasValidMlWholesaleTiers(tiers: unknown): boolean {
  if (!Array.isArray(tiers) || tiers.length === 0) return false;
  return tiers.some((t) => {
    if (t == null || typeof t !== "object") return false;
    const o = t as { min_purchase_unit?: unknown; amount?: unknown };
    const minU = Number(o.min_purchase_unit);
    const amt = Number(o.amount);
    return Number.isFinite(minU) && Number.isFinite(amt) && minU > 0 && amt > 0;
  });
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toSafeImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http://")) return `https://${trimmed.slice("http://".length)}`;
  return trimmed;
}

/**
 * GET /api/dashboard/summary?accountId=...
 * Retorna visão operacional para os cards principais e alertas.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId")?.trim();
  if (!accountId) {
    return NextResponse.json({ error: "accountId obrigatório" }, { status: 400 });
  }

  const { data: account, error: accountError } = await supabase
    .from("ml_accounts")
    .select("id, ml_user_id, ml_nickname")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .single();

  if (accountError || !account) {
    return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  }

  // 1) Linhas sincronizadas (mesma regra da grade atacado) e quantas têm atacado:
  //      rascunho válido em wholesale_drafts OU preço por quantidade vindo do ML (wholesale_prices_json na sync).
  const [
    { data: items },
    { data: variationRows },
    drafts,
    { data: cacheRows },
    { data: refs },
  ] = await Promise.all([
    supabase
      .from("ml_items")
      .select("item_id, has_variations, wholesale_prices_json")
      .eq("account_id", accountId),
    supabase.from("ml_variations").select("item_id, variation_id").eq("account_id", accountId),
    fetchAllWholesaleDraftsForAccount(supabase, accountId),
    supabase
      .from("pricing_cache")
      .select(
        "item_id, variation_id, title, thumbnail, current_price, cost_price, orders_30d, tax_percent, extra_fee_percent, fixed_expenses, calculated_fee, calculated_shipping_cost, product_id"
      )
      .eq("account_id", accountId),
    supabase
      .from("price_references")
      .select("item_id, variation_id, status")
      .eq("account_id", accountId),
  ]);

  const validDraftKeys = new Set<string>();
  for (const d of drafts) {
    if (!hasValidTier(d.tiers_json)) continue;
    const iid = String(d.item_id).trim().toUpperCase();
    if (d.variation_id == null) validDraftKeys.add(`${iid}:item`);
    else validDraftKeys.add(`${iid}:${Number(d.variation_id)}`);
  }

  const varsByItem = new Map<string, number[]>();
  for (const v of variationRows ?? []) {
    const id = v.item_id as string;
    const list = varsByItem.get(id) ?? [];
    list.push(Number(v.variation_id));
    varsByItem.set(id, list);
  }

  let synced_count = 0;
  let wholesale_configured_count = 0;

  for (const row of items ?? []) {
    const itemId = row.item_id as string;
    const upper = String(itemId).trim().toUpperCase();
    const hasVar = !!row.has_variations;
    const mlWholesale = hasValidMlWholesaleTiers(row.wholesale_prices_json);

    if (!hasVar) {
      synced_count += 1;
      const draftOk = validDraftKeys.has(`${upper}:item`);
      if (draftOk || mlWholesale) wholesale_configured_count += 1;
      continue;
    }

    const varIds = varsByItem.get(itemId) ?? [];
    for (const vid of varIds) {
      synced_count += 1;
      const draftOk =
        validDraftKeys.has(`${upper}:${vid}`) || validDraftKeys.has(`${upper}:item`);
      if (draftOk || mlWholesale) wholesale_configured_count += 1;
    }
  }

  const wholesale_missing_count = Math.max(0, synced_count - wholesale_configured_count);

  // 2) Competitividade (status de referência de preço já calculado no sistema)
  let competitive = 0;
  let attention = 0;
  let high = 0;
  let none = 0;
  for (const ref of refs ?? []) {
    switch (ref.status) {
      case "competitive":
        competitive++;
        break;
      case "attention":
        attention++;
        break;
      case "high":
        high++;
        break;
      default:
        none++;
        break;
    }
  }
  const competitivenessTotal = competitive + attention + high;
  const competitiveness_percent =
    competitivenessTotal > 0 ? Math.round((competitive / competitivenessTotal) * 100) : 0;

  // 3) Saúde de margem, risco e cobertura a partir do cache de precificação
  const riskThresholdPercent = 5;
  let revenueEstimated = 0;
  let profitEstimated = 0;
  let riskCount = 0;
  let noCostCount = 0;
  let negativeMarginCount = 0;
  let noSkuLinkCount = 0;
  let coverageCount = 0;

  for (const row of cacheRows ?? []) {
    const currentPrice = toNumber(row.current_price);
    const costPriceRaw = row.cost_price;
    const costPrice = costPriceRaw == null ? null : toNumber(costPriceRaw);
    const qty30d = Math.max(0, toNumber(row.orders_30d));
    const taxPercent = toNumber(row.tax_percent);
    const extraFeePercent = toNumber(row.extra_fee_percent);
    const fixedExpenses = toNumber(row.fixed_expenses);
    const calculatedFee = toNumber(row.calculated_fee);
    const calculatedShipping = toNumber(row.calculated_shipping_cost);

    if (!row.product_id) {
      noSkuLinkCount += 1;
    }
    if (row.product_id && costPrice != null && costPrice > 0) {
      coverageCount += 1;
    }
    if (costPrice == null || costPrice <= 0 || currentPrice <= 0) {
      noCostCount += 1;
      continue;
    }

    const taxValue = currentPrice * (taxPercent / 100);
    const extraFeeValue = currentPrice * (extraFeePercent / 100);
    const unitProfit =
      currentPrice -
      costPrice -
      calculatedFee -
      calculatedShipping -
      taxValue -
      extraFeeValue -
      fixedExpenses;
    const marginPercent = (unitProfit / currentPrice) * 100;

    if (marginPercent < 0) {
      negativeMarginCount += 1;
    }
    if (marginPercent < riskThresholdPercent) {
      riskCount += 1;
    }

    if (qty30d > 0) {
      revenueEstimated += currentPrice * qty30d;
      profitEstimated += unitProfit * qty30d;
    }
  }

  const totalListings = (cacheRows ?? []).length;
  const coverage_percent = totalListings > 0 ? Math.round((coverageCount / totalListings) * 100) : 0;
  const margin_avg_percent =
    revenueEstimated > 0 ? Number(((profitEstimated / revenueEstimated) * 100).toFixed(2)) : null;

  const body: DashboardSummaryResponse = {
    account: {
      id: account.id,
      ml_user_id: account.ml_user_id,
      ml_nickname: account.ml_nickname ?? null,
    },
    cards: {
      margin_avg_percent,
      margin_revenue_estimated: Number(revenueEstimated.toFixed(2)),
      risk_count: riskCount,
      competitiveness_percent,
      competitiveness: {
        competitive,
        attention,
        high,
        none,
        total: competitivenessTotal,
      },
      coverage_percent,
      coverage_count: coverageCount,
      total_listings: totalListings,
    },
    alerts: {
      no_cost: noCostCount,
      negative_margin: negativeMarginCount,
      above_market: high,
      no_wholesale: wholesale_missing_count,
      no_sku_link: noSkuLinkCount,
    },
    insights: {
      top_sales: [],
      top_margin: [],
      top_risk: [],
    },
  };

  const refsByKey = new Map<string, string>();
  for (const ref of refs ?? []) {
    const key = `${String(ref.item_id).trim().toUpperCase()}:${ref.variation_id == null ? -1 : Number(ref.variation_id)}`;
    refsByKey.set(key, String(ref.status ?? "none"));
  }

  const insightRows: InsightRow[] = [];
  for (const row of cacheRows ?? []) {
    const currentPrice = toNumber(row.current_price);
    const costPriceRaw = row.cost_price;
    const costPrice = costPriceRaw == null ? null : toNumber(costPriceRaw);
    const orders30d = Math.max(0, toNumber(row.orders_30d));
    const taxPercent = toNumber(row.tax_percent);
    const extraFeePercent = toNumber(row.extra_fee_percent);
    const fixedExpenses = toNumber(row.fixed_expenses);
    const calculatedFee = toNumber(row.calculated_fee);
    const calculatedShipping = toNumber(row.calculated_shipping_cost);

    let unitProfit: number | null = null;
    let marginPercent: number | null = null;
    if (costPrice != null && costPrice > 0 && currentPrice > 0) {
      const taxValue = currentPrice * (taxPercent / 100);
      const extraFeeValue = currentPrice * (extraFeePercent / 100);
      const profit =
        currentPrice -
        costPrice -
        calculatedFee -
        calculatedShipping -
        taxValue -
        extraFeeValue -
        fixedExpenses;
      unitProfit = Number(profit.toFixed(2));
      marginPercent = Number(((profit / currentPrice) * 100).toFixed(2));
    }

    const itemKey = `${String(row.item_id).trim().toUpperCase()}:${row.variation_id == null ? -1 : Number(row.variation_id)}`;
    const refStatus = refsByKey.get(itemKey) ?? "none";
    const isAboveMarket = refStatus === "high";
    let riskStatus: "high" | "attention" | "ok" = "ok";
    let riskReason: string | null = null;
    if (marginPercent != null && marginPercent < 0) {
      riskStatus = "high";
      riskReason = "Margem negativa";
    } else if (isAboveMarket) {
      riskStatus = "high";
      riskReason = "Preço acima do mercado";
    } else if (marginPercent == null || marginPercent < 5) {
      riskStatus = "attention";
      riskReason = marginPercent == null ? "Sem custo para calcular margem" : "Margem abaixo de 5%";
    }

    insightRows.push({
      item_id: String(row.item_id),
      variation_id: row.variation_id == null ? null : Number(row.variation_id),
      title: row.title == null ? null : String(row.title),
      thumbnail: toSafeImageUrl(row.thumbnail),
      current_price: currentPrice,
      orders_30d: orders30d,
      margin_percent: marginPercent,
      unit_profit: unitProfit,
      is_above_market: isAboveMarket,
      risk_status: riskStatus,
      risk_reason: riskReason,
    });
  }

  const topSales = [...insightRows]
    .sort((a, b) => b.orders_30d - a.orders_30d)
    .slice(0, 5);

  const topMargin = [...insightRows]
    .filter((r) => r.margin_percent != null)
    .sort((a, b) => (b.margin_percent ?? -9999) - (a.margin_percent ?? -9999))
    .slice(0, 5);

  const topRisk = [...insightRows]
    .filter((r) => r.risk_status !== "ok")
    .sort((a, b) => {
      const aScore =
        (a.margin_percent != null && a.margin_percent < 0 ? -200 : 0) +
        (a.is_above_market ? -100 : 0) +
        (a.margin_percent ?? 100);
      const bScore =
        (b.margin_percent != null && b.margin_percent < 0 ? -200 : 0) +
        (b.is_above_market ? -100 : 0) +
        (b.margin_percent ?? 100);
      return aScore - bScore;
    })
    .slice(0, 5);

  body.insights = {
    top_sales: topSales,
    top_margin: topMargin,
    top_risk: topRisk,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
