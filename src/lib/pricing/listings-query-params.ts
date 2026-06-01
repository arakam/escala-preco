import {
  parseStockCompareFilter,
  parseStockCompareFilterDecimal,
} from "@/lib/mercadolivre/item-tags";

/** Filtros de GET /api/pricing/listings e POST /api/pricing/recalculate-fees (mesmos query params). */
export type PricingListingsQueryParams = {
  search: string;
  statusFilter: string;
  linkedParam: string;
  orderBy: string;
  skuFilter: string;
  supplierFilter: string;
  onlyWithSales30d: boolean;
  orders30dFilter: ReturnType<typeof parseStockCompareFilter>;
  costFilter: ReturnType<typeof parseStockCompareFilterDecimal>;
  discountFilter: ReturnType<typeof parseStockCompareFilterDecimal>;
  profitFilter: ReturnType<typeof parseStockCompareFilterDecimal>;
  semPromoMlAtiva: boolean;
  fullOnly: boolean;
  tagIds: string[];
};

export function parsePricingListingsQueryParams(url: URL): PricingListingsQueryParams {
  const tagIdsParam = url.searchParams.get("tags")?.trim() || "";
  return {
    search: url.searchParams.get("search")?.trim() || "",
    statusFilter: url.searchParams.get("status")?.trim() || "",
    linkedParam: url.searchParams.get("linked")?.trim() || "",
    orderBy: url.searchParams.get("order_by")?.trim() || "",
    skuFilter: url.searchParams.get("sku")?.trim() || "",
    supplierFilter: url.searchParams.get("supplier")?.trim() || "",
    onlyWithSales30d: url.searchParams.get("only_with_sales") === "1",
    orders30dFilter: parseStockCompareFilter(
      url.searchParams.get("orders_30d_op") ?? "",
      url.searchParams.get("orders_30d_qty") ?? ""
    ),
    costFilter: parseStockCompareFilterDecimal(
      url.searchParams.get("cost_op") ?? "",
      url.searchParams.get("cost_qty") ?? ""
    ),
    discountFilter: parseStockCompareFilterDecimal(
      url.searchParams.get("discount_op") ?? "",
      url.searchParams.get("discount_qty") ?? ""
    ),
    profitFilter: parseStockCompareFilterDecimal(
      url.searchParams.get("profit_op") ?? "",
      url.searchParams.get("profit_qty") ?? ""
    ),
    semPromoMlAtiva: url.searchParams.get("sem_promo_ml") === "1",
    fullOnly:
      url.searchParams.get("full_only") === "1" || url.searchParams.get("full_only") === "true",
    tagIds: tagIdsParam ? tagIdsParam.split(",").map((s) => s.trim()).filter(Boolean) : [],
  };
}
