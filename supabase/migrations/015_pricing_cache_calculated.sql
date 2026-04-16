-- Dados do último cálculo de preço (taxa ML, frete, líquido) para consulta rápida e filtros de lucratividade.
ALTER TABLE pricing_cache
  ADD COLUMN IF NOT EXISTS calculated_price DECIMAL(20, 2),
  ADD COLUMN IF NOT EXISTS calculated_fee DECIMAL(20, 2),
  ADD COLUMN IF NOT EXISTS calculated_shipping_cost DECIMAL(20, 2),
  ADD COLUMN IF NOT EXISTS calculated_at TIMESTAMPTZ;

COMMENT ON COLUMN pricing_cache.calculated_price IS 'Preço usado no último cálculo (ex.: planned_price na época)';
COMMENT ON COLUMN pricing_cache.calculated_fee IS 'Taxa ML retornada no último cálculo';
COMMENT ON COLUMN pricing_cache.calculated_shipping_cost IS 'Frete (ex.: Mercado Envios) no último cálculo';
COMMENT ON COLUMN pricing_cache.calculated_at IS 'Quando o cálculo foi feito';
