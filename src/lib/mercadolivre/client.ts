/**
 * Cliente HTTP para APIs do Mercado Livre.
 * - Listagem paginada de item_ids: GET /users/{id}/items/search
 * - Detalhe de item: GET /items/{item_id}
 * Com timeout, retry e respeito a rate-limit (429).
 */

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;
const RATE_LIMIT_BACKOFF_MS = 5000;

export interface ItemsSearchResponse {
  results: string[];
  paging: { total: number; offset: number; limit: number };
}

export interface MLItemDetail {
  id: string;
  title: string;
  status: string;
  permalink: string;
  thumbnail: string;
  category_id: string;
  listing_type_id: string;
  site_id: string;
  price: number;
  currency_id: string;
  available_quantity: number;
  sold_quantity: number;
  condition: string;
  shipping: unknown;
  seller_custom_field: string | null;
  variations?: Array<{
    id: number;
    price: number;
    available_quantity: number;
    attribute_combinations?: Array<{ id: string; value_name: string }>;
    seller_custom_field?: string;
  }>;
  [key: string]: unknown;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

async function fetchWithRetry(
  url: string,
  accessToken: string,
  options: { timeout?: number } = {}
): Promise<Response> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout,
        }
      );
      if (res.status === 429) {
        const wait = RATE_LIMIT_BACKOFF_MS;
        console.warn(`[ML client] 429 rate limit em ${url}, aguardando ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

/**
 * Lista todos os item_ids do seller (paginado).
 */
export async function fetchAllItemIds(
  mlUserId: string,
  accessToken: string,
  onPage?: (offset: number, total: number) => void
): Promise<string[]> {
  const limit = 50;
  let offset = 0;
  let total = 1;
  const allIds: string[] = [];
  while (offset < total) {
    const url = `https://api.mercadolibre.com/users/${mlUserId}/items/search?offset=${offset}&limit=${limit}`;
    const res = await fetchWithRetry(url, accessToken);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`items/search failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as ItemsSearchResponse;
    const results = data.results ?? [];
    const paging = data.paging ?? { total: 0, offset: 0, limit };
    total = paging.total;
    allIds.push(...results);
    offset += results.length;
    onPage?.(offset, total);
    if (results.length === 0) break;
  }
  return allIds;
}

/**
 * Busca detalhes de um item.
 */
export async function fetchItemDetail(
  itemId: string,
  accessToken: string
): Promise<MLItemDetail> {
  const url = `https://api.mercadolibre.com/items/${itemId}`;
  const res = await fetchWithRetry(url, accessToken);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`items/${itemId} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as MLItemDetail;
}

/**
 * Executa até `concurrency` funções assíncronas em paralelo, enfileirando o restante.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      if (i >= items.length) break;
      const r = await fn(items[i]);
      results[i] = r;
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
