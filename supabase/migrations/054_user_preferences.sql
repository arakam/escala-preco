-- Preferências por usuário (chave + JSON), ex.: arredondamento do Preço Final em Preços.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, preference_key)
);

COMMENT ON TABLE user_preferences IS 'Preferências da conta (JSON por chave); sincroniza entre dispositivos.';
COMMENT ON COLUMN user_preferences.preference_key IS 'Identificador estável (ex.: pricing_price_rounding)';

CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own user_preferences"
  ON user_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
