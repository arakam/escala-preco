-- Timestamp da última consulta de estoque Full na API ML (TTL na sync)
ALTER TABLE ml_items
  ADD COLUMN IF NOT EXISTS fulfillment_synced_at TIMESTAMPTZ;

COMMENT ON COLUMN ml_items.fulfillment_synced_at IS
  'Última vez que fulfillment_stock foi consultado via GET /inventories/{id}/stock/fulfillment';

CREATE INDEX IF NOT EXISTS idx_ml_items_fulfillment_refresh
  ON ml_items (account_id, is_fulfillment, fulfillment_synced_at)
  WHERE is_fulfillment = true;
