-- ID da promoção/campanha no ML (campo `id` em seller-promotions/items).
ALTER TABLE promotions_cache_rows
  ADD COLUMN IF NOT EXISTS ml_promotion_id TEXT;

CREATE INDEX IF NOT EXISTS idx_promotions_cache_rows_account_user_item
  ON promotions_cache_rows (account_id, user_id, item_id);
