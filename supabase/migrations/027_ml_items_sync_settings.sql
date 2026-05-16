-- Sincronização automática via webhook (tópico items) e dimensões/peso do anúncio ML

ALTER TABLE ml_accounts
  ADD COLUMN IF NOT EXISTS auto_sync_items_webhook BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN ml_accounts.auto_sync_items_webhook IS
  'Quando true, notificações webhook topic=items disparam sync do anúncio (resource /items/{id}).';

ALTER TABLE ml_items
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS weight_kg DECIMAL(12, 4),
  ADD COLUMN IF NOT EXISTS height_cm DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS width_cm DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS length_cm DECIMAL(12, 2);

CREATE INDEX IF NOT EXISTS idx_ml_items_synced_at ON ml_items(account_id, synced_at DESC);
