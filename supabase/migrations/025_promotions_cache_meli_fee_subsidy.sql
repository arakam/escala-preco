-- Subsídio ML (R$) por linha de promoção; taxa ML no cache passa a ser o valor bruto (antes do abatimento).
ALTER TABLE promotions_cache_rows
  ADD COLUMN IF NOT EXISTS meli_fee_subsidy NUMERIC;
