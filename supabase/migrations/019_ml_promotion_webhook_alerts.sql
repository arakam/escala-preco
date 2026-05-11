-- Avisos derivados de webhooks public_candidates / public_offers (convite ou mudança de oferta).
CREATE TABLE IF NOT EXISTS ml_promotion_webhook_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  resource_path TEXT NOT NULL,
  item_id TEXT,
  external_id TEXT,
  promotion_id TEXT,
  promotion_type TEXT,
  status_label TEXT,
  fetch_error TEXT,
  raw_api JSONB
);

CREATE INDEX IF NOT EXISTS idx_ml_promo_alerts_account_created
  ON ml_promotion_webhook_alerts(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ml_promo_alerts_user_item
  ON ml_promotion_webhook_alerts(user_id, item_id, created_at DESC)
  WHERE item_id IS NOT NULL;

ALTER TABLE ml_promotion_webhook_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own promotion webhook alerts"
  ON ml_promotion_webhook_alerts FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT apenas via service role (webhook).
