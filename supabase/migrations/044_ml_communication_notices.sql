-- Comunicações do Mercado Livre (GET /communications/notices) com estado de leitura local.
CREATE TABLE IF NOT EXISTS ml_communication_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  notice_id TEXT NOT NULL,
  label TEXT NOT NULL,
  title TEXT,
  description TEXT,
  highlighted BOOLEAN NOT NULL DEFAULT false,
  from_date TIMESTAMPTZ,
  category TEXT,
  sub_category TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  dismiss_key TEXT,
  read_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, notice_id)
);

CREATE INDEX IF NOT EXISTS idx_ml_comm_notices_user_unread
  ON ml_communication_notices(user_id, read_at, from_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_ml_comm_notices_account
  ON ml_communication_notices(account_id, from_date DESC NULLS LAST);

ALTER TABLE ml_communication_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own ml communication notices"
  ON ml_communication_notices FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own ml communication notices"
  ON ml_communication_notices FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own ml communication notices"
  ON ml_communication_notices FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own ml communication notices"
  ON ml_communication_notices FOR DELETE
  USING (auth.uid() = user_id);
