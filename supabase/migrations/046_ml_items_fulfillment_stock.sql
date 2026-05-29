-- Estoque Full (depósito ML) e flag consolidada para filtros/UI
ALTER TABLE ml_items
  ADD COLUMN IF NOT EXISTS fulfillment_stock INTEGER,
  ADD COLUMN IF NOT EXISTS is_fulfillment BOOLEAN;

COMMENT ON COLUMN ml_items.fulfillment_stock IS
  'Saldo disponível no estoque Full (GET /inventories/{id}/stock/fulfillment); NULL se não consultado ou não Full';
COMMENT ON COLUMN ml_items.is_fulfillment IS
  'Anúncio Full: true se há estoque Full na API ou tag fulfillment / logistic_type fulfillment';

CREATE INDEX IF NOT EXISTS idx_ml_items_is_fulfillment
  ON ml_items (account_id, is_fulfillment)
  WHERE is_fulfillment = true;

-- Backfill inicial a partir da tag já sincronizada
UPDATE ml_items
SET is_fulfillment = COALESCE(
  is_fulfillment,
  tags_text IS NOT NULL AND tags_text @> ARRAY['fulfillment']::text[]
)
WHERE is_fulfillment IS NULL;
