-- Tabela de itens sincronizados (anúncios ML)
CREATE TABLE IF NOT EXISTS ml_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  title TEXT,
  status TEXT,
  permalink TEXT,
  thumbnail TEXT,
  category_id TEXT,
  listing_type_id TEXT,
  site_id TEXT,
  price DECIMAL(20, 2),
  currency_id TEXT,
  available_quantity INTEGER,
  sold_quantity INTEGER,
  condition TEXT,
  shipping_json JSONB,
  seller_custom_field TEXT,
  has_variations BOOLEAN DEFAULT false,
  raw_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, item_id)
);

-- Tabela de variações por item
CREATE TABLE IF NOT EXISTS ml_variations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  variation_id BIGINT NOT NULL,
  seller_custom_field TEXT,
  attributes_json JSONB,
  price DECIMAL(20, 2),
  available_quantity INTEGER,
  raw_json JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, item_id, variation_id)
);

-- Jobs de sincronização (e outros no futuro)
CREATE TABLE IF NOT EXISTS ml_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'sync_items',
  status TEXT NOT NULL DEFAULT 'queued',
  total INTEGER DEFAULT 0,
  processed INTEGER DEFAULT 0,
  ok INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ml_jobs_status_check CHECK (status IN ('queued', 'running', 'success', 'failed', 'partial'))
);

-- Logs por item/variation dentro do job
CREATE TABLE IF NOT EXISTS ml_job_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES ml_jobs(id) ON DELETE CASCADE,
  item_id TEXT,
  variation_id BIGINT,
  status TEXT NOT NULL,
  message TEXT,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ml_job_logs_status_check CHECK (status IN ('ok', 'error'))
);

-- RLS
ALTER TABLE ml_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_job_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own ml_items via account"
  ON ml_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = ml_items.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = ml_items.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own ml_variations via account"
  ON ml_variations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = ml_variations.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = ml_variations.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own ml_jobs via account"
  ON ml_jobs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = ml_jobs.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ml_accounts
      WHERE ml_accounts.id = ml_jobs.account_id
      AND ml_accounts.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view own ml_job_logs via job"
  ON ml_job_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ml_jobs j
      JOIN ml_accounts a ON a.id = j.account_id
      WHERE j.id = ml_job_logs.job_id AND a.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own ml_job_logs via job"
  ON ml_job_logs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ml_jobs j
      JOIN ml_accounts a ON a.id = j.account_id
      WHERE j.id = ml_job_logs.job_id AND a.user_id = auth.uid()
    )
  );

-- Índices
CREATE INDEX IF NOT EXISTS idx_ml_items_account_id ON ml_items(account_id);
CREATE INDEX IF NOT EXISTS idx_ml_items_updated_at ON ml_items(updated_at);
CREATE INDEX IF NOT EXISTS idx_ml_variations_account_item ON ml_variations(account_id, item_id);
CREATE INDEX IF NOT EXISTS idx_ml_jobs_account_type_status ON ml_jobs(account_id, type, status);
CREATE INDEX IF NOT EXISTS idx_ml_job_logs_job_id ON ml_job_logs(job_id);
