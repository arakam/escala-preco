-- Promoções ativas do anúncio (GET /seller-promotions/items/{id}), preenchido no refresh do cache de preços.
ALTER TABLE pricing_cache
  ADD COLUMN IF NOT EXISTS ml_active_promotions TEXT;

COMMENT ON COLUMN pricing_cache.ml_active_promotions IS 'Uma linha por promoção ativa (nome, tipo, valor); separador newline. Atualizado em refreshPricingCache.';
