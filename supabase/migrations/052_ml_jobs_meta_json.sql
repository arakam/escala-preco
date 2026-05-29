-- Metadados opcionais do job (ex.: lista de item_ids para sync_fulfillment_stock)
ALTER TABLE ml_jobs ADD COLUMN IF NOT EXISTS meta_json JSONB;
