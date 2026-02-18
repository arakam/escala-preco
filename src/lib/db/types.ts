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
