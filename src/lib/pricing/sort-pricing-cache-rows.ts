export type PricingCacheRow = Record<string, unknown>;

export function sortPricingCacheRows(rows: PricingCacheRow[], orderBy: string): PricingCacheRow[] {
  const copy = [...rows];
  if (orderBy === "orders_desc") {
    copy.sort((a, b) => Number(b.orders_30d ?? 0) - Number(a.orders_30d ?? 0));
  } else if (orderBy === "orders_asc") {
    copy.sort((a, b) => Number(a.orders_30d ?? 0) - Number(b.orders_30d ?? 0));
  } else if (orderBy === "cost_desc") {
    copy.sort((a, b) => Number(b.cost_price ?? -1) - Number(a.cost_price ?? -1));
  } else if (orderBy === "cost_asc") {
    copy.sort((a, b) => Number(a.cost_price ?? Infinity) - Number(b.cost_price ?? Infinity));
  } else if (orderBy === "profit_desc") {
    copy.sort(
      (a, b) => Number(b.profit_margin_percent ?? -1) - Number(a.profit_margin_percent ?? -1)
    );
  } else if (orderBy === "profit_asc") {
    copy.sort(
      (a, b) =>
        Number(a.profit_margin_percent ?? Infinity) - Number(b.profit_margin_percent ?? Infinity)
    );
  } else {
    copy.sort((a, b) =>
      String(a.sort_title ?? "").localeCompare(String(b.sort_title ?? ""), "pt-BR")
    );
  }
  return copy;
}
