-- Preços por quantidade (atacado) vindos do ML na sincronização
ALTER TABLE ml_items
  ADD COLUMN IF NOT EXISTS wholesale_prices_json JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN ml_items.wholesale_prices_json IS 'Array de { min_purchase_unit, amount } do GET /items/{id}/prices (show-all-prices)';
