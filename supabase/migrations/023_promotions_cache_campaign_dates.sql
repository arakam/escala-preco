-- Datas de campanha informadas pelo ML (seller-promotions), quando existirem.
ALTER TABLE promotions_cache_rows
  ADD COLUMN IF NOT EXISTS campaign_start_at TIMESTAMPTZ;

ALTER TABLE promotions_cache_rows
  ADD COLUMN IF NOT EXISTS campaign_finish_at TIMESTAMPTZ;
