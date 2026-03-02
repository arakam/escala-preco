/**
 * Consulta taxas de venda (sale fee) do Mercado Livre via listing_prices.
 * Cache em memória por (site_id, listing_type_id, price) com TTL de 15 min.
 */

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

type CacheEntry = { fee: number; expiresAt: number };

const feeCache = new Map<string, CacheEntry>();

function cacheKey(siteId: string, listingTypeId: string, price: number): string {
  const p = Math.round(price * 100) / 100;
  return `${siteId}:${listingTypeId}:${p}`;
}

export interface ListingPriceResult {
  listing_type_id: string;
  sale_fee_amount: number;
  currency_id: string;
}

/**
 * Retorna a taxa de venda (sale_fee_amount) para um preço no site/tipo de anúncio.
 * Usa cache; em caso de erro lança ou retorna null conforme needThrow.
 */
export async function fetchSaleFee(
  accessToken: string,
  siteId: string,
  listingTypeId: string,
  price: number
): Promise<{ fee: number; currency_id: string } | null> {
  const key = cacheKey(siteId, listingTypeId, price);
  const cached = feeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { fee: cached.fee, currency_id: "BRL" };
  }

  const url = `https://api.mercadolibre.com/sites/${encodeURIComponent(siteId)}/listing_prices?price=${encodeURIComponent(price)}&listing_type_id=${encodeURIComponent(listingTypeId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[fees] ML API error:", res.status, text);
    return null;
  }

  const data = (await res.json()) as ListingPriceResult[];
  
  if (!Array.isArray(data) || data.length === 0) {
    console.warn("[fees] No data returned from listing_prices API");
    return null;
  }
  
  // Try exact match first
  let item = data.find((d) => d.listing_type_id === listingTypeId);
  
  // If no exact match, try to find a reasonable fallback
  if (!item) {
    // Common listing types in order of preference for fallback
    const fallbackOrder = ["gold_special", "gold_pro", "gold", "silver", "bronze", "free"];
    for (const fallbackType of fallbackOrder) {
      item = data.find((d) => d.listing_type_id === fallbackType);
      if (item) {
        console.warn(`[fees] Using fallback listing_type_id: ${fallbackType} instead of ${listingTypeId}`);
        break;
      }
    }
  }
  
  if (!item || typeof item.sale_fee_amount !== "number") {
    console.warn("[fees] No matching listing_type_id found. Requested:", listingTypeId, "Available:", data.map(d => d.listing_type_id));
    return null;
  }

  const fee = item.sale_fee_amount;
  feeCache.set(key, { fee, expiresAt: Date.now() + CACHE_TTL_MS });
  return { fee, currency_id: item.currency_id ?? "BRL" };
}
