-- Referência de taxa ML (% do preço) por site + categoria + tipo de listagem,
-- amostrada na sincronização (listing_prices) para iteração rápida na resolução de margem.

CREATE TABLE IF NOT EXISTS ml_category_fee_reference (
  site_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  listing_type_id TEXT NOT NULL,
  fee_percent NUMERIC(14, 6) NOT NULL,
  sample_price NUMERIC(20, 4) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, category_id, listing_type_id)
);

COMMENT ON TABLE ml_category_fee_reference IS
  'Taxa de venda ML como % do preço (sale_fee_amount/preço×100) amostrada via listing_prices na sync; usada na busca de preço por margem antes da confirmação com a API.';
COMMENT ON COLUMN ml_category_fee_reference.fee_percent IS 'Percentual: fee BRL / preço BRL × 100 no sample_price.';
COMMENT ON COLUMN ml_category_fee_reference.sample_price IS 'Preço usado na última amostragem listing_prices.';

ALTER TABLE ml_category_fee_reference ENABLE ROW LEVEL SECURITY;

-- Sem políticas para JWT: leitura/escrita apenas via service role (sync, APIs).

ALTER TABLE pricing_cache
  ADD COLUMN IF NOT EXISTS reference_fee_percent NUMERIC(14, 6);

COMMENT ON COLUMN pricing_cache.reference_fee_percent IS
  'Cópia do % taxa ML (ml_category_fee_reference) para o par categoria+tipo do anúncio; preenchido no refresh do cache.';
