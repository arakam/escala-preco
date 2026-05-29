-- Colunas geradas para filtros/ordenação na tela de Preços (catálogo completo, sem lote no cliente).

ALTER TABLE pricing_cache
  ADD COLUMN IF NOT EXISTS discount_percent DECIMAL(10, 2) GENERATED ALWAYS AS (
    CASE
      WHEN current_price IS NULL OR current_price <= 0 THEN NULL
      WHEN ROUND(planned_price * 100) = ROUND(current_price * 100) THEN 0
      ELSE ROUND(
        ((current_price - planned_price) / current_price * 100.0)::numeric,
        2
      )
    END
  ) STORED,
  ADD COLUMN IF NOT EXISTS profit_margin_percent DECIMAL(10, 2) GENERATED ALWAYS AS (
    CASE
      WHEN cost_price IS NULL OR planned_price IS NULL OR planned_price <= 0 THEN NULL
      WHEN calculated_price IS NOT NULL
        AND calculated_fee IS NOT NULL
        AND calculated_shipping_cost IS NOT NULL
        AND ABS(calculated_price - planned_price) < 0.02 THEN
        ROUND(
          (
            (
              calculated_price
              - calculated_fee
              - calculated_shipping_cost
              - COALESCE(planned_price * tax_percent / 100.0, 0)
              - COALESCE(planned_price * extra_fee_percent / 100.0, 0)
              - COALESCE(fixed_expenses, 0)
              - cost_price
            ) / planned_price * 100.0
          )::numeric,
          2
        )
      ELSE
        ROUND(((planned_price - cost_price) / planned_price * 100.0)::numeric, 2)
    END
  ) STORED;

COMMENT ON COLUMN pricing_cache.discount_percent IS
  'Desconto % (preço ML → planned_price); alinhado ao filtro da tela de Preços.';
COMMENT ON COLUMN pricing_cache.profit_margin_percent IS
  'Margem líquida % sobre planned_price quando há cálculo recente; senão margem bruta (planned − custo).';

CREATE INDEX IF NOT EXISTS idx_pricing_cache_account_discount
  ON pricing_cache (account_id, discount_percent)
  WHERE discount_percent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pricing_cache_account_profit_margin
  ON pricing_cache (account_id, profit_margin_percent)
  WHERE profit_margin_percent IS NOT NULL;
