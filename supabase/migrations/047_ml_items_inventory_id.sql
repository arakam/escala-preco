-- inventory_id do ML (GET /items) — chave para estoque Full, distinto de MLB/MLBU
ALTER TABLE ml_items
  ADD COLUMN IF NOT EXISTS inventory_id TEXT;

ALTER TABLE ml_variations
  ADD COLUMN IF NOT EXISTS inventory_id TEXT;

COMMENT ON COLUMN ml_items.inventory_id IS
  'Código de inventário Full no ML (ex. LCQI05831); vem de GET /items/{id}.inventory_id';
COMMENT ON COLUMN ml_variations.inventory_id IS
  'inventory_id da variação quando o anúncio tem variações no depósito Full';

CREATE INDEX IF NOT EXISTS idx_ml_items_inventory_id
  ON ml_items (account_id, inventory_id)
  WHERE inventory_id IS NOT NULL;

-- Backfill a partir do raw_json já sincronizado
UPDATE ml_items
SET inventory_id = NULLIF(TRIM(raw_json->>'inventory_id'), '')
WHERE inventory_id IS NULL
  AND raw_json->>'inventory_id' IS NOT NULL
  AND TRIM(raw_json->>'inventory_id') <> ''
  AND TRIM(raw_json->>'inventory_id') !~ '^ML[A-Z][0-9]';

UPDATE ml_items
SET is_fulfillment = true
WHERE is_fulfillment IS NOT TRUE
  AND inventory_id IS NOT NULL;
