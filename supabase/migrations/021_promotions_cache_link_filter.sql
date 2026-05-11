-- Filtro "Vínculo MLB → produto" na tela Promoções (alinha a pricing_cache / ml_items.product_id).
ALTER TABLE promotions_cache_rows
  ADD COLUMN IF NOT EXISTS cache_link_filter TEXT NOT NULL DEFAULT 'all';

ALTER TABLE promotions_cache_rows
  DROP CONSTRAINT IF EXISTS promotions_cache_rows_cache_link_filter_check;

ALTER TABLE promotions_cache_rows
  ADD CONSTRAINT promotions_cache_rows_cache_link_filter_check
  CHECK (cache_link_filter IN ('all', 'linked', 'unlinked'));

DROP INDEX IF EXISTS idx_promotions_cache_row_unique;

CREATE UNIQUE INDEX idx_promotions_cache_row_unique
  ON promotions_cache_rows (account_id, cache_page, cache_search, cache_link_filter, row_key);

DROP INDEX IF EXISTS idx_promotions_cache_lookup;

CREATE INDEX idx_promotions_cache_lookup
  ON promotions_cache_rows (account_id, cache_page, cache_search, cache_link_filter);
