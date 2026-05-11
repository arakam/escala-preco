-- Tipo de campanha ML (`seller-promotions` → campo `type`), ex.: DEAL, SMART, SELLER_CAMPAIGN.
ALTER TABLE promotions_cache_rows
  ADD COLUMN IF NOT EXISTS promotion_type TEXT;

CREATE INDEX IF NOT EXISTS idx_promotions_cache_promotion_type
  ON promotions_cache_rows (account_id, cache_link_filter, promotion_type)
  WHERE promotion_type IS NOT NULL;
