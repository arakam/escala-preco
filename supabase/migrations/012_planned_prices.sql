-- Preços planejados da calculadora (novo preço salvo por MLB e SKU)
-- Vincula account_id + item_id (MLB) + variation_id ao preço que o usuário quer aplicar

CREATE TABLE IF NOT EXISTS planned_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  variation_id BIGINT NOT NULL DEFAULT -1,
  sku TEXT,
  planned_price DECIMAL(20, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, item_id, variation_id)
);

COMMENT ON TABLE planned_prices IS 'Preço novo planejado na calculadora, vinculado a MLB (item_id) e opcionalmente SKU';
COMMENT ON COLUMN planned_prices.item_id IS 'ID do anúncio no ML (MLB)';
COMMENT ON COLUMN planned_prices.variation_id IS 'ID da variação; -1 para item sem variações';
COMMENT ON COLUMN planned_prices.sku IS 'SKU do anúncio/variação (para exibição e busca)';
COMMENT ON COLUMN planned_prices.planned_price IS 'Novo preço que o usuário planeja aplicar';

CREATE INDEX IF NOT EXISTS idx_planned_prices_account_id ON planned_prices(account_id);
CREATE INDEX IF NOT EXISTS idx_planned_prices_item_id ON planned_prices(account_id, item_id);

ALTER TABLE planned_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage planned_prices via own account"
  ON planned_prices FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ml_accounts ma
      WHERE ma.id = planned_prices.account_id
        AND ma.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ml_accounts ma
      WHERE ma.id = planned_prices.account_id
        AND ma.user_id = auth.uid()
    )
  );
