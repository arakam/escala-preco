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
  /** Modelo clássico: array de variações. Modelo User Product (MLBU): não existe; cada item é uma "variação". */
  variations?: Array<{
    id: number;
    price: number;
    available_quantity: number;
    attribute_combinations?: Array<{ id: string; value_name: string }>;
    seller_custom_field?: string;
  }>;
  /** User Product (UP) / MLBU: ID do produto no modelo Price per Variation. */
  user_product_id?: string | null;
  /** User Product: ID da família que agrupa vários UPs. */
  family_id?: string | null;
  /** User Product: nome genérico do produto (família). */
  family_name?: string | null;
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
  options: { timeout?: number; method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<Response> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: options.method ?? "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
          },
          body: options.body,
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

export interface ItemsSearchScanResponse {
  results: string[];
  paging: { total: number; offset: number; limit: number };
  scroll_id?: string;
}

/**
 * Lista todos os item_ids do seller usando search_type=scan para suportar mais de 1000 itens.
 * A API do ML retorna erro "Invalid limit and offset values" quando offset > 1000,
 * então usamos scroll_id para paginação de grandes volumes.
 */
export async function fetchAllItemIds(
  mlUserId: string,
  accessToken: string,
  onPage?: (offset: number, total: number) => void
): Promise<string[]> {
  const limit = 100;
  const allIds: string[] = [];
  let scrollId: string | undefined;
  let total = 0;
  let fetched = 0;

  // Primeira requisição com search_type=scan
  const firstUrl = `https://api.mercadolibre.com/users/${mlUserId}/items/search?search_type=scan&limit=${limit}`;
  const firstRes = await fetchWithRetry(firstUrl, accessToken);
  if (!firstRes.ok) {
    const text = await firstRes.text();
    throw new Error(`items/search failed: ${firstRes.status} ${text}`);
  }
  const firstData = (await firstRes.json()) as ItemsSearchScanResponse;
  const firstResults = firstData.results ?? [];
  total = firstData.paging?.total ?? 0;
  scrollId = firstData.scroll_id;
  allIds.push(...firstResults);
  fetched += firstResults.length;
  onPage?.(fetched, total);

  // Continuar com scroll_id enquanto houver mais resultados
  while (scrollId && fetched < total) {
    const url = `https://api.mercadolibre.com/users/${mlUserId}/items/search?search_type=scan&limit=${limit}&scroll_id=${scrollId}`;
    const res = await fetchWithRetry(url, accessToken);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`items/search failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as ItemsSearchScanResponse;
    const results = data.results ?? [];
    if (results.length === 0) break;
    allIds.push(...results);
    fetched += results.length;
    scrollId = data.scroll_id;
    onPage?.(fetched, total);
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
 * PUT em /items/{itemId} com body JSON.
 */
export async function putItem(
  itemId: string,
  accessToken: string,
  body: Record<string, unknown>,
  options: { timeout?: number } = {}
): Promise<{ ok: true; data?: unknown } | { ok: false; status: number; body: string; json?: unknown }> {
  const url = `https://api.mercadolibre.com/items/${itemId}`;
  const res = await fetchWithRetry(url, accessToken, {
    method: "PUT",
    body: JSON.stringify(body),
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (res.ok) {
    return { ok: true, data: json };
  }
  return { ok: false, status: res.status, body: text, json };
}

/**
 * GET /items/{itemId}/prices — lista preços do item (inclui preço por quantidade com show-all-prices).
 */
export async function getItemPrices(
  itemId: string,
  accessToken: string,
  options: { showAllPrices?: boolean } = {}
): Promise<{ id: string; prices: Array<{ id: string; type?: string; amount?: number; conditions?: { min_purchase_unit?: number } }> } | null> {
  const url = `https://api.mercadolibre.com/items/${itemId}/prices`;
  const res = await fetchWithRetry(url, accessToken, {
    headers: options.showAllPrices ? { "show-all-prices": "true" } : undefined,
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: string; prices: Array<{ id: string; type?: string; amount?: number; conditions?: { min_purchase_unit?: number } }> };
}

/**
 * POST em /items/{itemId}/prices/standard/quantity — preços por quantidade (atacado).
 * Documentação: https://developers.mercadolivre.com.br/pt_br/precos-por-quantidade
 */
export async function postItemPricesQuantity(
  itemId: string,
  accessToken: string,
  body: { prices: Array<Record<string, unknown>> },
  options: { timeout?: number } = {}
): Promise<{ ok: true; data?: unknown } | { ok: false; status: number; body: string; json?: unknown }> {
  const url = `https://api.mercadolibre.com/items/${itemId}/prices/standard/quantity`;
  const res = await fetchWithRetry(url, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
    timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (res.ok) {
    return { ok: true, data: json };
  }
  return { ok: false, status: res.status, body: text, json };
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
