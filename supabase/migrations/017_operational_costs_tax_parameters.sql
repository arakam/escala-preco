-- Custos operacionais mensais por usuário (valores em R$)
CREATE TABLE IF NOT EXISTS operational_costs (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  monthly_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_key)
);

COMMENT ON TABLE operational_costs IS 'Custos operacionais da empresa informados pelo usuário (base mensal em R$)';
COMMENT ON COLUMN operational_costs.category_key IS 'Identificador fixo da categoria (ex.: payroll, rent)';
COMMENT ON COLUMN operational_costs.monthly_amount IS 'Valor mensal em R$';

CREATE INDEX IF NOT EXISTS idx_operational_costs_user_id ON operational_costs(user_id);

ALTER TABLE operational_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own operational_costs"
  ON operational_costs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Parâmetros de impostos da empresa (percentuais; uso futuro em relatórios / calculadora)
CREATE TABLE IF NOT EXISTS tax_parameters (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL,
  percent NUMERIC(8, 4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category_key)
);

COMMENT ON TABLE tax_parameters IS 'Percentuais de impostos / contribuições informados pelo usuário (uso global da empresa)';
COMMENT ON COLUMN tax_parameters.percent IS 'Percentual (ex.: 6.5 = 6,5%)';

CREATE INDEX IF NOT EXISTS idx_tax_parameters_user_id ON tax_parameters(user_id);

ALTER TABLE tax_parameters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own tax_parameters"
  ON tax_parameters FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
