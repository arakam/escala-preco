-- Estoque Full por variação (depósito ML por inventory_id)
ALTER TABLE ml_variations
  ADD COLUMN IF NOT EXISTS fulfillment_stock INTEGER;

COMMENT ON COLUMN ml_variations.fulfillment_stock IS
  'Saldo no depósito Full para esta variação (GET /inventories/{inventory_id}/stock/fulfillment total ou user-products meli_facility)';
