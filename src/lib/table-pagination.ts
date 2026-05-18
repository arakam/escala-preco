/** Valor do select "Linhas" para exibir todos os registros na tela. */
export const PAGE_SIZE_ALL = 0;

export const SUPABASE_RANGE_BATCH = 1000;

export const TABLE_PAGE_SIZE_OPTIONS = [
  10, 20, 25, 50, 100, 250, 500, 750, 1000,
] as const;

export const PRECO_PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 500, 1000] as const;

export function isAllPageSize(pageSize: number): boolean {
  return pageSize === PAGE_SIZE_ALL;
}

export function computeTotalPages(total: number, pageSize: number): number {
  if (isAllPageSize(pageSize) || total <= 0) return 1;
  return Math.ceil(total / pageSize);
}

export function apiListPage(pageSize: number, page: number): number {
  return isAllPageSize(pageSize) ? 1 : page;
}

type RangeQueryResult<T> = {
  data: T[] | null;
  error: unknown;
  count?: number | null;
};

/** Busca todas as linhas em lotes (limite ~1000 do Supabase por request). */
export async function fetchAllViaRange<T>(
  fetchPage: (from: number, to: number) => PromiseLike<RangeQueryResult<T>>
): Promise<{ rows: T[]; total: number; error: unknown }> {
  const rows: T[] = [];
  let total = 0;
  let from = 0;

  while (true) {
    const to = from + SUPABASE_RANGE_BATCH - 1;
    const { data, error, count } = await fetchPage(from, to);
    if (error) return { rows: [], total: 0, error };
    if (from === 0 && count != null) total = count;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < SUPABASE_RANGE_BATCH) break;
    from += SUPABASE_RANGE_BATCH;
  }

  if (total === 0) total = rows.length;
  return { rows, total, error: null };
}
