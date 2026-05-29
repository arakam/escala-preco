import type { StockCompareOp } from "@/lib/mercadolivre/item-tags";

/** Query Supabase encadeável (select/update) com comparadores numéricos. */
export type NumericCompareQuery = {
  gt(column: string, value: number): NumericCompareQuery;
  gte(column: string, value: number): NumericCompareQuery;
  lt(column: string, value: number): NumericCompareQuery;
  lte(column: string, value: number): NumericCompareQuery;
  eq(column: string, value: number): NumericCompareQuery;
  not(column: string, operator: string, value: unknown): NumericCompareQuery;
  or(filters: string): NumericCompareQuery;
  is(column: string, value: null): NumericCompareQuery;
  eq(column: string, value: string): NumericCompareQuery;
};

export function applyNumericCompareFilter<T extends NumericCompareQuery>(
  q: T,
  column: string,
  op: StockCompareOp,
  qty: number
): T {
  switch (op) {
    case "gt":
      return q.gt(column, qty);
    case "gte":
      return q.gte(column, qty);
    case "lt":
      return q.lt(column, qty);
    case "lte":
      return q.lte(column, qty);
    case "eq":
      return q.eq(column, qty);
    default:
      return q;
  }
}
