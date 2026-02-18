-- Tabela de contas Mercado Livre (multi-tenant: 0..N por usuário)
CREATE TABLE IF NOT EXISTS ml_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ml_user_id BIGINT NOT NULL,
  ml_nickname TEXT,
  site_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, ml_user_id)
);

-- Tabela de tokens por conta
CREATE TABLE IF NOT EXISTS ml_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id)
);

-- RLS: usuário só acessa suas próprias contas e tokens
ALTER TABLE ml_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own ml_accounts"
  ON ml_accounts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own ml_tokens via account"
  ON ml_tokens FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = ml_tokens.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = ml_tokens.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  );

-- Índices
CREATE INDEX IF NOT EXISTS idx_ml_accounts_user_id ON ml_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_ml_tokens_account_id ON ml_tokens(account_id);
