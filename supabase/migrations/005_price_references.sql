-- Referências de preço do Mercado Livre (benchmarks/sugestões) por item/variação
-- UNIQUE por (account_id, item_id, variation_id) onde variation_id NULL = item sem variação
CREATE TABLE IF NOT EXISTS price_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  variation_id BIGINT,
  variation_key TEXT NOT NULL GENERATED ALWAYS AS (COALESCE(variation_id::text, 'item')) STORED,
  current_price_snapshot DECIMAL(20, 2) NOT NULL,
  reference_json JSONB NOT NULL DEFAULT '{}',
  reference_type TEXT NOT NULL DEFAULT 'none',
  suggested_price DECIMAL(20, 2),
  min_reference_price DECIMAL(20, 2),
  max_reference_price DECIMAL(20, 2),
  status TEXT NOT NULL DEFAULT 'none',
  explanation TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unicidade por linha editável (upsert usa esta constraint)
ALTER TABLE price_references ADD CONSTRAINT price_references_account_item_variation_key
  UNIQUE (account_id, item_id, variation_key);

-- Índices para joins e filtros
CREATE INDEX IF NOT EXISTS idx_price_references_account_id ON price_references(account_id);
CREATE INDEX IF NOT EXISTS idx_price_references_account_status ON price_references(account_id, status);
CREATE INDEX IF NOT EXISTS idx_price_references_account_item ON price_references(account_id, item_id);

-- RLS: usuário acessa apenas referências das suas contas
ALTER TABLE price_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own price_references via account"
  ON price_references FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = price_references.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = price_references.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  );

COMMENT ON TABLE price_references IS 'Cache de referências/sugestões de preço do ML por item (e opcionalmente variação)';
COMMENT ON COLUMN price_references.reference_type IS 'range | suggested | none';
COMMENT ON COLUMN price_references.status IS 'competitive | attention | high | none';
