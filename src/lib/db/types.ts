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
}
