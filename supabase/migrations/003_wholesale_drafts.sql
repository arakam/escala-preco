-- Tabela de rascunhos de preço de atacado (por item ou variação)
CREATE TABLE IF NOT EXISTS wholesale_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  variation_id BIGINT,
  tiers_json JSONB NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, item_id, variation_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_wholesale_drafts_account_id ON wholesale_drafts(account_id);
CREATE INDEX IF NOT EXISTS idx_wholesale_drafts_account_item ON wholesale_drafts(account_id, item_id);

-- RLS
ALTER TABLE wholesale_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own wholesale_drafts via account"
  ON wholesale_drafts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = wholesale_drafts.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = wholesale_drafts.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  );
