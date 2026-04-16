-- Cache materializado para a tela de preços: uma linha por anúncio/variação com dados
-- de ml_items, ml_variations, products, planned_prices e vendas 30d.
-- Atualizado após sync, vínculo MLB-SKU e ao salvar preços planejados; leitura rápida com filtros.

CREATE TABLE IF NOT EXISTS pricing_cache (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  variation_id BIGINT NOT NULL DEFAULT -1,
  title TEXT,
  thumbnail TEXT,
  permalink TEXT,
  status TEXT,
  listing_type_id TEXT,
  category_id TEXT,
  current_price DECIMAL(20, 2) NOT NULL DEFAULT 0,
  sku TEXT,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  cost_price DECIMAL(20, 2),
  weight_kg DECIMAL(12, 4),
  height_cm DECIMAL(10, 2),
  width_cm DECIMAL(10, 2),
  length_cm DECIMAL(10, 2),
  tax_percent DECIMAL(5, 2),
  extra_fee_percent DECIMAL(5, 2),
  fixed_expenses DECIMAL(12, 2),
  planned_price DECIMAL(20, 2) NOT NULL,
  sales_30d INTEGER NOT NULL DEFAULT 0,
  orders_30d INTEGER NOT NULL DEFAULT 0,
  sort_title TEXT NOT NULL DEFAULT '',
  cache_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, item_id, variation_id)
);

COMMENT ON TABLE pricing_cache IS 'Cache para tela de preços: dados unificados de anúncios, produtos, preço planejado e vendas 30d';
COMMENT ON COLUMN pricing_cache.variation_id IS '-1 para item sem variações; id da variação para ml_variations';
COMMENT ON COLUMN pricing_cache.planned_price IS 'Preço planejado (planned_prices) ou current_price se não houver';
COMMENT ON COLUMN pricing_cache.sort_title IS 'Título em minúsculas para ordenação';

CREATE INDEX IF NOT EXISTS idx_pricing_cache_account_id ON pricing_cache(account_id);
CREATE INDEX IF NOT EXISTS idx_pricing_cache_account_status ON pricing_cache(account_id, status) WHERE status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pricing_cache_sort ON pricing_cache(account_id, sort_title);
CREATE INDEX IF NOT EXISTS idx_pricing_cache_sku ON pricing_cache(account_id) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pricing_cache_product ON pricing_cache(account_id, product_id) WHERE product_id IS NOT NULL;

ALTER TABLE pricing_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read pricing_cache via own account"
  ON pricing_cache FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ml_accounts ma
      WHERE ma.id = pricing_cache.account_id AND ma.user_id = auth.uid()
    )
  );
