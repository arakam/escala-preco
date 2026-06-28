import type { FullPricingBreakdown } from "@/lib/pricing/full-net";

export interface PricingListing {
  id: string;
  item_id: string;
  variation_id: number | null;
  title: string | null;
  thumbnail: string | null;
  permalink: string | null;
  status: string | null;
  listing_type_id: string | null;
  category_id: string | null;
  current_price: number;
  sku: string | null;
  product_id: string | null;
  cost_price: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  account_id: string;
  ml_active_promotions?: string | null;
  reference_fee_percent?: number | null;
  pma?: number | null;
}

export type CalculatedPricing = FullPricingBreakdown;

export interface ListingWithPricing extends PricingListing {
  new_price: number;
  calculated?: CalculatedPricing;
  calculating?: boolean;
  dirty?: boolean;
}

export type PriceReferenceStatus = "competitive" | "attention" | "high" | "none";

export interface PriceReferenceCell {
  status: string;
  suggested_price: number | null;
  min_reference_price: number | null;
  max_reference_price: number | null;
  explanation: string | null;
  updated_at: string | null;
}

export const ML_MIN_CAMPAIGN_DISCOUNT_PERCENT = 5;
export const ML_MAX_CAMPAIGN_DISCOUNT_PERCENT = 80;

export function priceRefRowKey(itemId: string, variationId: number | null): string {
  return `${String(itemId).trim().toUpperCase()}:${variationId ?? "item"}`;
}

export function listingSelectionKey(l: Pick<PricingListing, "id" | "item_id" | "variation_id">): string {
  if (l.id) return l.id;
  return `${l.item_id}:${l.variation_id ?? "n"}`;
}

export function competitivenessBadge(status: string | undefined): { label: string; className: string } {
  switch (status as PriceReferenceStatus) {
    case "competitive":
      return { label: "Competitivo", className: "bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-200" };
    case "attention":
      return { label: "Atenção", className: "bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" };
    case "high":
      return { label: "Preço alto", className: "bg-red-200 text-red-800 dark:bg-red-900/40 dark:text-red-200" };
    default:
      return { label: "Sem referência", className: "bg-gray-200 text-fg dark:bg-slate-600 dark:text-slate-200" };
  }
}

export function skuDisplayParts(rawSku: string): { primary: string; extraCount: number } {
  const text = rawSku.trim();
  if (!text) return { primary: "", extraCount: 0 };

  const plusMatch = text.match(/\(\+(\d+)\s*SKUs?\)/i);
  const plusCount = plusMatch ? Number(plusMatch[1]) : 0;
  const withoutPlus = text.replace(/\s*\(\+\d+\s*SKUs?\)\s*/i, "").trim();
  const parts = withoutPlus
    .split("·")
    .map((p) => p.trim())
    .filter((p) => p && p !== "…");

  const primary = parts[0] ?? withoutPlus;
  const extraCount = plusCount > 0 ? plusCount : Math.max(0, parts.length - 1);
  return { primary, extraCount };
}

export function meetsMlMinCampaignDiscount(listing: Pick<ListingWithPricing, "current_price" | "new_price">): boolean {
  if (listing.current_price <= 0 || listing.new_price <= 0) return false;
  const maxPromoOverCurrent = 1 - ML_MIN_CAMPAIGN_DISCOUNT_PERCENT / 100;
  return listing.new_price <= listing.current_price * maxPromoOverCurrent;
}
