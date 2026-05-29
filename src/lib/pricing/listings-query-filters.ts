import type { StockCompareOp } from "@/lib/mercadolivre/item-tags";

/**
 * Aplica gt/gte/lt/lte/eq em query Supabase sem generic (evita "excessively deep" no PostgrestBuilder).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyNumericCompareFilter(q: any, column: string, op: StockCompareOp, qty: number): any {
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
