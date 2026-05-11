-- Snapshot da tela Promoções (linhas já “achatadas”: uma por promoção + cálculos persistidos).
CREATE TABLE IF NOT EXISTS promotions_cache_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_page INT NOT NULL DEFAULT 1,
  cache_search TEXT NOT NULL DEFAULT '',
  row_key TEXT NOT NULL,
  item_id TEXT NOT NULL,
  title TEXT,
  status TEXT,
  thumbnail TEXT,
  permalink TEXT,
  updated_at TIMESTAMPTZ,
  listing_type_id TEXT,
  category_id TEXT,
  list_price NUMERIC,
  active_price NUMERIC,
  promotion_kind TEXT NOT NULL,
  promotion_label TEXT,
  promo_price NUMERIC,
  value_hint TEXT,
  promotions_api_failed BOOLEAN NOT NULL DEFAULT false,
  cost_price NUMERIC,
  weight_kg NUMERIC,
  height_cm NUMERIC,
  width_cm NUMERIC,
  length_cm NUMERIC,
  tax_percent NUMERIC,
  extra_fee_percent NUMERIC,
  fixed_expenses NUMERIC,
  fee NUMERIC,
  shipping_cost NUMERIC,
  tax_amount NUMERIC,
  extra_fee_amount NUMERIC,
  fixed_expenses_amount NUMERIC,
  net_amount NUMERIC,
  profit NUMERIC,
  profit_percent NUMERIC,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_mercado_lider_snapshot BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_cache_row_unique
  ON promotions_cache_rows (account_id, cache_page, cache_search, row_key);

CREATE INDEX IF NOT EXISTS idx_promotions_cache_lookup
  ON promotions_cache_rows (account_id, cache_page, cache_search);

ALTER TABLE promotions_cache_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own promotions cache"
  ON promotions_cache_rows FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own promotions cache"
  ON promotions_cache_rows FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own promotions cache"
  ON promotions_cache_rows FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own promotions cache"
  ON promotions_cache_rows FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
