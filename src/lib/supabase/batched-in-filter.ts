/** UUIDs no `.in()` do PostgREST estouram o limite de ~16KB de headers HTTP (~50 por lote). */
export const UUID_IN_BATCH = 50;

/** Máximo de cláusulas `col.in.(…)` num `.or()` antes de estourar a URL. */
export const UUID_OR_BATCH_MAX = 10;

export function chunkIds(ids: string[], batchSize = UUID_IN_BATCH): string[][] {
  const unique = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += batchSize) {
    batches.push(unique.slice(i, i + batchSize));
  }
  return batches;
}

type InOrQuery = {
  in: (column: string, values: string[]) => InOrQuery;
  or: (filters: string) => InOrQuery;
};

/**
 * Aplica filtro `column IN ids` em lotes pequenos (PostgREST).
 * Até {@link UUID_OR_BATCH_MAX} lotes usa `.or()`; acima disso retorna `null` (caller faz busca em lotes).
 */
export function applyBatchedInFilter(
  query: InOrQuery,
  column: string,
  ids: string[]
): InOrQuery | null {
  const batches = chunkIds(ids);
  if (batches.length === 0) return query;
  if (batches.length === 1) {
    return query.in(column, batches[0]!) as InOrQuery;
  }
  if (batches.length <= UUID_OR_BATCH_MAX) {
    const orExpr = batches.map((batch) => `${column}.in.(${batch.join(",")})`).join(",");
    return query.or(orExpr) as InOrQuery;
  }
  return null;
}
