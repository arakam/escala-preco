export interface MLAccount {
  id: string;
  user_id: string;
  ml_user_id: number;
  ml_nickname: string | null;
  site_id: string | null;
  created_at: string;
}

export interface MLToken {
  id: string;
  account_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface MLAccountWithToken extends MLAccount {
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
}

export interface Product {
  id: string;
  user_id: string;
  sku: string;
  title: string;
  description: string | null;
  ean: string | null;
  height: number | null;
  width: number | null;
  length: number | null;
  weight: number | null;
  cost_price: number | null;
  sale_price: number | null;
  tax_percent: number | null;
  extra_fee_percent: number | null;
  fixed_expenses: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProductInput {
  sku: string;
  title: string;
  description?: string | null;
  ean?: string | null;
  height?: number | null;
  width?: number | null;
  length?: number | null;
  weight?: number | null;
  cost_price?: number | null;
  sale_price?: number | null;
  tax_percent?: number | null;
  extra_fee_percent?: number | null;
  fixed_expenses?: number | null;
}

export interface ProductListingStats {
  product_id: string;
  user_id: string;
  sku: string;
  title: string;
  cost_price: number | null;
  sale_price: number | null;
  total_items: number;
  total_variations: number;
  total_listings: number;
  active_items: number;
  active_variations: number;
  min_item_price: number | null;
  max_item_price: number | null;
  avg_item_price: number | null;
  total_available_qty: number;
  total_sold_qty: number;
}

export interface UnlinkedListing {
  user_id: string;
  account_nickname: string;
  listing_type: 'item' | 'variation';
  item_id: string;
  variation_id: number | null;
  title: string | null;
  sku: string;
  price: number | null;
  status: string | null;
  available_quantity: number | null;
}

export interface UnregisteredSku {
  sku: string;
  listing_count: number;
  sample_title: string | null;
}

export interface LinkResult {
  items_linked: number;
  variations_linked: number;
}
