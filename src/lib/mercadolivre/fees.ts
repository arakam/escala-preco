/**
 * Consulta taxas de venda (sale fee) do Mercado Livre via listing_prices.
 * Cache em memória por (site_id, listing_type_id, price) com TTL de 15 min.
 */

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

type CacheEntry = { fee: number; expiresAt: number };

const feeCache = new Map<string, CacheEntry>();

function cacheKey(siteId: string, listingTypeId: string, price: number, categoryId: string): string {
  const p = Math.round(price * 100) / 100;
  return `${siteId}:${listingTypeId}:${categoryId}:${p}`;
}

export interface ListingPriceResult {
  listing_type_id: string;
  sale_fee_amount: number;
  currency_id: string;
}

/**
 * Retorna a taxa de venda (sale_fee_amount) para um preço no site/tipo de anúncio/categoria.
 * Usa cache; em caso de erro lança ou retorna null conforme needThrow.
 */
export async function fetchSaleFee(
  accessToken: string,
  siteId: string,
  listingTypeId: string,
  price: number,
  categoryId: string
): Promise<{ fee: number; currency_id: string } | null> {
  const key = cacheKey(siteId, listingTypeId, price, categoryId);
  const cached = feeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { fee: cached.fee, currency_id: "BRL" };
  }

  const url = `https://api.mercadolibre.com/sites/${encodeURIComponent(siteId)}/listing_prices?price=${encodeURIComponent(price)}&listing_type_id=${encodeURIComponent(listingTypeId)}&category_id=${encodeURIComponent(categoryId)}`;
  
  console.log("[fees] Fetching:", url);
  
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("[fees] ML API error:", res.status, text);
    return null;
  }

  const data = await res.json();
  
  console.log("[fees] API response:", JSON.stringify(data).substring(0, 500));
  
  let item: ListingPriceResult | undefined;
  
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.warn("[fees] Empty array returned from listing_prices API");
      return null;
    }
    
    item = data.find((d: ListingPriceResult) => d.listing_type_id === listingTypeId);
    
    if (!item) {
      const fallbackOrder = ["gold_special", "gold_pro", "gold", "silver", "bronze", "free"];
      for (const fallbackType of fallbackOrder) {
        item = data.find((d: ListingPriceResult) => d.listing_type_id === fallbackType);
        if (item) {
          console.warn(`[fees] Using fallback listing_type_id: ${fallbackType} instead of ${listingTypeId}`);
          break;
        }
      }
    }
    
    if (!item) {
      console.warn("[fees] No matching listing_type_id found. Requested:", listingTypeId, "Available:", data.map((d: ListingPriceResult) => d.listing_type_id));
      return null;
    }
  } else if (data && typeof data === "object" && typeof data.sale_fee_amount === "number") {
    item = data as ListingPriceResult;
  } else {
    console.warn("[fees] Unexpected response format:", typeof data);
    return null;
  }
  
  if (!item || typeof item.sale_fee_amount !== "number") {
    console.warn("[fees] No sale_fee_amount found in response");
    return null;
  }

  const fee = item.sale_fee_amount;
  feeCache.set(key, { fee, expiresAt: Date.now() + CACHE_TTL_MS });
  return { fee, currency_id: item.currency_id ?? "BRL" };
}
