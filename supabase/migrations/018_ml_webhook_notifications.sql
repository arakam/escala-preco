-- Eventos de webhook do Mercado Livre (uma linha por conta EscalaPreço quando o mesmo ml_user_id está ligado a vários usuários).
CREATE TABLE IF NOT EXISTS ml_webhook_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ml_user_id BIGINT NOT NULL,
  topic TEXT NOT NULL,
  resource TEXT,
  application_id TEXT,
  attempts INT,
  ml_sent_at TIMESTAMPTZ,
  actions JSONB,
  notification_id TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ml_webhook_notifications_user_created
  ON ml_webhook_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ml_webhook_notifications_ml_user
  ON ml_webhook_notifications(ml_user_id, created_at DESC);

ALTER TABLE ml_webhook_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own ml webhook notifications"
  ON ml_webhook_notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Inserções apenas via service role (rota /wh/api).
