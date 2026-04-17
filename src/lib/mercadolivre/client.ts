/**
 * Cliente HTTP para APIs do Mercado Livre.
 * - Listagem paginada de item_ids: GET /users/{id}/items/search
 * - Detalhe de item: GET /items/{item_id}
 * Com timeout, retry e respeito a rate-limit (429).
 */

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_NETWORK_RETRIES = 4;
/** Máximo de respostas 429 seguidas antes de desistir nesta requisição */
const MAX_429_ROUNDS = 10;

/** Pausa compartilhada: vários workers em paralelo não devem martelar o ML ao mesmo tempo após 429 */
let mlGlobalCooldownUntil = 0;

function extendMlGlobalCooldown(ms: number) {
  const until = Date.now() + ms;
  mlGlobalCooldownUntil = Math.max(mlGlobalCooldownUntil, until);
}

async function waitMlGlobalCooldown() {
  const now = Date.now();
  if (mlGlobalCooldownUntil <= now) return;
  const d = mlGlobalCooldownUntil - now;
  console.warn(`[ML client] cooldown global pós-429: aguardando ${Math.round(d)}ms antes da próxima chamada`);
  await new Promise((r) => setTimeout(r, d));
}

/**
 * Uma fila global por processo Node: só uma requisição HTTP ao ML por vez.
 * Evita 429 quando vários anúncios /items, /prices e variações disparam ao mesmo tempo.
 * Desative com ML_HTTP_SERIAL=0 (mais rápido, mais risco de 429).
 */
const ML_HTTP_SERIAL =
  process.env.ML_HTTP_SERIAL !== "0" && process.env.ML_HTTP_SERIAL !== "false";

let mlHttpChain: Promise<unknown> = Promise.resolve();

function runMlHttpSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const p = mlHttpChain.then(() => fn());
  mlHttpChain = p.then(
    () => undefined,
    () => undefined
  );
  return p as Promise<T>;
}

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
    attributes?: Array<{ id: string; value_name?: string | null }>;
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
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...options.headers,
  };

  async function oneFetch(): Promise<Response> {
    await waitMlGlobalCooldown();
    const exec = () =>
      fetchWithTimeout(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body,
        timeout,
      });
    if (ML_HTTP_SERIAL) {
      return runMlHttpSerialized(exec);
    }
    return exec();
  }

  let lastError: unknown;
  for (let net = 0; net < MAX_NETWORK_RETRIES; net++) {
    try {
      let res = await oneFetch();
      let r429 = 0;
      while (res.status === 429 && r429 < MAX_429_ROUNDS) {
        r429++;
        const wait = Math.min(4000 * Math.pow(1.35, r429 - 1), 90_000);
        const jitter = Math.floor(Math.random() * 800);
        extendMlGlobalCooldown(wait + jitter);
        console.warn(
          `[ML client] 429 em ${url.slice(0, 80)}… — pausa ${Math.round(wait + jitter)}ms (${r429}/${MAX_429_ROUNDS}) [cooldown global aplicado]`
        );
        await new Promise((r) => setTimeout(r, wait + jitter));
        res = await oneFetch();
      }
      if (res.status === 429) {
        throw new Error(
          "API do Mercado Livre: limite de requisições (429) após várias tentativas. Tente sincronizar de novo em alguns minutos."
        );
      }
      return res;
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[ML client] falha de rede/timeout (tentativa ${net + 1}/${MAX_NETWORK_RETRIES}) em ${url.slice(0, 72)}… — ${msg}`
      );
      if (net < MAX_NETWORK_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (net + 1)));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Falha ao chamar API do Mercado Livre"));
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

export interface MLVariationDetail {
  id: number;
  price?: number;
  available_quantity?: number;
  attribute_combinations?: Array<{ id: string; value_name: string }>;
  attributes?: Array<{ id: string; value_name?: string | null }>;
  seller_custom_field?: string | null;
  [key: string]: unknown;
}

/**
 * Busca detalhes de uma variação específica.
 * GET /items/{itemId}/variations/{variationId}
 * Retorna dados completos incluindo o array `attributes` com SELLER_SKU.
 */
export async function fetchVariationDetail(
  itemId: string,
  variationId: number,
  accessToken: string
): Promise<MLVariationDetail> {
  const url = `https://api.mercadolibre.com/items/${itemId}/variations/${variationId}`;
  const res = await fetchWithRetry(url, accessToken);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`items/${itemId}/variations/${variationId} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as MLVariationDetail;
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

/** Resposta de GET /items/{itemId}/prices (API de preços do ML). */
export interface MLItemPricesResponse {
  id: string;
  prices: Array<{
    id: string;
    type?: string;
    amount?: number;
    regular_amount?: number | null;
    currency_id?: string;
    conditions?: { min_purchase_unit?: number; context_restrictions?: string[] };
  }>;
}

/**
 * GET /items/{itemId}/prices — lista preços do item (inclui preço por quantidade com show-all-prices).
 * Documentação: https://developers.mercadolivre.com.br/pt_br/api-de-precos
 */
export async function getItemPrices(
  itemId: string,
  accessToken: string,
  options: { showAllPrices?: boolean } = {}
): Promise<MLItemPricesResponse | null> {
  const url = `https://api.mercadolibre.com/items/${itemId}/prices`;
  const res = await fetchWithRetry(url, accessToken, {
    headers: options.showAllPrices ? { "show-all-prices": "true" } : undefined,
  });
  if (!res.ok) return null;
  return (await res.json()) as MLItemPricesResponse;
}

/**
 * Extrai o preço padrão (standard) da resposta GET /items/{id}/prices.
 * Preço standard = preço original sem promoções (recomendado pela API de preços do ML).
 * Retorna null se não houver preço do tipo "standard".
 */
export function getStandardPriceAmount(
  response: MLItemPricesResponse | null
): number | null {
  if (!response?.prices?.length) return null;
  const standard = response.prices.find((p) => p.type === "standard");
  if (standard?.amount != null) return Number(standard.amount);
  return null;
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
