/**
 * Referências de preços / Sugestões de preços — Mercado Livre.
 * Endpoints oficiais: marketplace/benchmarks (pricing reference).
 * Documentação: https://global-selling.mercadolibre.com/devsite/pricing-reference
 */

/** Endpoint base para benchmarks (referências de preço). Troque aqui se a URL mudar. */
export const PRICE_REFERENCE_BASE = "https://api.mercadolibre.com/marketplace/benchmarks";
/** Lista de item_ids com referência para um seller */
export const PRICE_REFERENCE_USER_ITEMS = `${PRICE_REFERENCE_BASE}/user`;
/** Detalhes da referência de um item: GET .../items/{ITEM_ID}/details */
export const PRICE_REFERENCE_ITEM_DETAILS = `${PRICE_REFERENCE_BASE}/items`;

export type PriceReferenceStatus = "competitive" | "attention" | "high" | "none";

export interface PriceReferenceSummary {
  suggested_price: number | null;
  min_reference_price: number | null;
  max_reference_price: number | null;
  status: PriceReferenceStatus;
  explanation: string;
  updated_at: string;
}

/** Resposta do GET .../marketplace/benchmarks/items/{ITEM_ID}/details */
export interface MLPriceReferenceDetails {
  item_id: string;
  status?: string;
  currency_id?: string;
  current_price?: { amount?: number; usd_amount?: number };
  suggested_price?: { amount?: number; usd_amount?: number };
  lowest_price?: { amount?: number; usd_amount?: number };
  percent_difference?: number;
  last_updated?: string;
  applicable_suggestion?: boolean;
  [key: string]: unknown;
}

/** Resposta do GET .../marketplace/benchmarks/user/{USER_ID}/items */
export interface MLPriceReferenceUserItems {
  total?: number;
  items?: string[];
}

const DEFAULT_ATTENTION_PCT = 2;
const DEFAULT_HIGH_PCT = 5;

export interface ClassifyTolerances {
  attentionPct?: number;
  highPct?: number;
}

/**
 * Classificação pura: dado preço atual e resumo da referência, retorna status e explicação.
 * Usado quando temos suggested_price (ou min/max) e precisamos de tolerâncias configuráveis.
 */
export function classifyReference(
  currentPrice: number,
  summary: {
    suggested_price?: number | null;
    min_reference_price?: number | null;
    max_reference_price?: number | null;
  },
  tolerances: ClassifyTolerances = {}
): { status: PriceReferenceStatus; explanation: string } {
  const attentionPct = tolerances.attentionPct ?? DEFAULT_ATTENTION_PCT;
  const highPct = tolerances.highPct ?? DEFAULT_HIGH_PCT;

  const suggested = summary.suggested_price ?? null;
  const minRef = summary.min_reference_price ?? null;
  const maxRef = summary.max_reference_price ?? null;

  if (currentPrice <= 0) {
    return { status: "none", explanation: "Preço inválido." };
  }

  // Faixa (min/max)
  if (minRef != null && maxRef != null) {
    if (currentPrice > maxRef) {
      const pct = maxRef > 0 ? (((currentPrice - maxRef) / maxRef) * 100).toFixed(1) : "0";
      return {
        status: "high",
        explanation: `Preço atual (R$ ${currentPrice.toFixed(2)}) está acima do limite superior da faixa (R$ ${maxRef.toFixed(2)}), +${pct}%.`,
      };
    }
    if (currentPrice >= minRef && currentPrice <= maxRef) {
      return {
        status: "competitive",
        explanation: `Preço dentro da faixa recomendada (R$ ${minRef.toFixed(2)} – R$ ${maxRef.toFixed(2)}).`,
      };
    }
    const mid = (minRef + maxRef) / 2;
    if (currentPrice < minRef && currentPrice >= mid) {
      return {
        status: "attention",
        explanation: `Preço abaixo do mínimo da faixa (R$ ${minRef.toFixed(2)}). Considere ajustar.`,
      };
    }
    if (currentPrice < mid) {
      return {
        status: "competitive",
        explanation: `Preço abaixo da faixa recomendada (R$ ${minRef.toFixed(2)} – R$ ${maxRef.toFixed(2)}).`,
      };
    }
  }

  // Apenas preço sugerido
  if (suggested != null && suggested > 0) {
    const diffPct = ((currentPrice - suggested) / suggested) * 100;
    if (diffPct > highPct) {
      return {
        status: "high",
        explanation: `Preço atual (R$ ${currentPrice.toFixed(2)}) está ${diffPct.toFixed(1)}% acima do sugerido (R$ ${suggested.toFixed(2)}).`,
      };
    }
    if (diffPct > attentionPct) {
      return {
        status: "attention",
        explanation: `Preço atual (R$ ${currentPrice.toFixed(2)}) está ${diffPct.toFixed(1)}% acima do sugerido (R$ ${suggested.toFixed(2)}).`,
      };
    }
    if (diffPct >= -attentionPct) {
      return {
        status: "competitive",
        explanation: `Preço alinhado ao sugerido (R$ ${suggested.toFixed(2)}).`,
      };
    }
    return {
      status: "competitive",
      explanation: `Preço abaixo do sugerido (R$ ${suggested.toFixed(2)}).`,
    };
  }

  return { status: "none", explanation: "Sem referência de preço disponível." };
}

/** Mapeia status retornado pela API ML para nosso status interno */
export function mapMLStatusToInternal(mlStatus: string | undefined): PriceReferenceStatus {
  switch (mlStatus) {
    case "with_benchmark_highest":
      return "high";
    case "with_benchmark_high":
      return "attention";
    case "no_benchmark_ok":
    case "no_benchmark_lowest":
      return "competitive";
    default:
      return "none";
  }
}

const RATE_LIMIT_BACKOFF_MS = 5000;
const DEFAULT_TIMEOUT_MS = 15000;

async function fetchWithRetry(
  url: string,
  accessToken: string,
  options: { timeout?: number } = {}
): Promise<Response> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  for (let attempt = 0; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.status === 429) {
        console.warn("[priceReferences] 429 rate limit, backoff", RATE_LIMIT_BACKOFF_MS);
        await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(timeoutId);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      throw e;
    }
  }
  throw new Error("Rate limit retries exceeded");
}

/**
 * Lista item_ids que possuem referência de preço para o seller.
 */
export async function fetchUserPriceReferenceItems(
  mlUserId: string,
  accessToken: string
): Promise<string[]> {
  const url = `${PRICE_REFERENCE_USER_ITEMS}/${mlUserId}/items`;
  const res = await fetchWithRetry(url, accessToken);
  if (!res.ok) {
    if (res.status === 404) return [];
    const text = await res.text();
    throw new Error(`benchmarks/user/items failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as MLPriceReferenceUserItems;
  return data.items ?? [];
}

/**
 * Busca detalhes da referência de preço de um item.
 * Retorna null se 404 ou item sem referência.
 */
export async function fetchItemPriceReferenceDetails(
  itemId: string,
  accessToken: string
): Promise<MLPriceReferenceDetails | null> {
  const url = `${PRICE_REFERENCE_ITEM_DETAILS}/${itemId}/details`;
  const res = await fetchWithRetry(url, accessToken);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`benchmarks/items/details failed: ${res.status} ${text}`);
  }
  return (await res.json()) as MLPriceReferenceDetails;
}

/**
 * Extrai do payload da API ML um resumo normalizado (suggested, min, max) e status/explanation
 * usando o preço atual (da linha item/variação).
 */
export function normalizeMLDetailsToSummary(
  details: MLPriceReferenceDetails,
  currentPrice: number
): {
  reference_type: "suggested" | "range" | "none";
  suggested_price: number | null;
  min_reference_price: number | null;
  max_reference_price: number | null;
  status: PriceReferenceStatus;
  explanation: string;
} {
  const suggestedAmount = details.suggested_price?.amount ?? null;
  const suggested = suggestedAmount != null ? Number(suggestedAmount) : null;

  let reference_type: "suggested" | "range" | "none" = suggested != null ? "suggested" : "none";
  let minRef: number | null = null;
  let maxRef: number | null = null;

  if (details.lowest_price?.amount != null) {
    const low = Number(details.lowest_price.amount);
    if (suggested != null) {
      minRef = Math.min(low, suggested);
      maxRef = Math.max(low, suggested);
      reference_type = "range";
    } else {
      minRef = low;
      maxRef = low;
    }
  } else if (suggested != null) {
    minRef = suggested;
    maxRef = suggested;
  }

  const mlStatus = details.status;
  const internalStatus = mapMLStatusToInternal(mlStatus);
  const { status, explanation } =
    internalStatus !== "none"
      ? { status: internalStatus, explanation: explanationFromML(mlStatus, details) }
      : classifyReference(currentPrice, { suggested_price: suggested, min_reference_price: minRef, max_reference_price: maxRef });

  return {
    reference_type,
    suggested_price: suggested,
    min_reference_price: minRef,
    max_reference_price: maxRef,
    status,
    explanation,
  };
}

function explanationFromML(mlStatus: string | undefined, details: MLPriceReferenceDetails): string {
  const cur = details.current_price?.amount ?? 0;
  const sug = details.suggested_price?.amount ?? 0;
  const pct = details.percent_difference ?? (sug > 0 ? ((cur - sug) / sug) * 100 : 0);
  switch (mlStatus) {
    case "with_benchmark_highest":
      return `Preço acima da referência e dos concorrentes (${pct.toFixed(1)}% acima do sugerido).`;
    case "with_benchmark_high":
      return `Preço acima da referência sugerida (${pct.toFixed(1)}%).`;
    case "no_benchmark_ok":
      return "Preço alinhado à referência.";
    case "no_benchmark_lowest":
      return "Preço abaixo da referência.";
    default:
      return `Referência: R$ ${sug.toFixed(2)}. Diferença: ${pct.toFixed(1)}%.`;
  }
}
