-- Saúde e tags do anúncio (GET /items/{id}) para listagem em Anúncios
ALTER TABLE ml_items
  ADD COLUMN IF NOT EXISTS health NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS tags_json JSONB;

COMMENT ON COLUMN ml_items.health IS 'Qualidade do anúncio no ML (0–1); campo health da API';
COMMENT ON COLUMN ml_items.tags_json IS 'Array de tags do item (strings) retornado pela API do ML';

-- Preenche a partir do cache raw_json de syncs anteriores
UPDATE ml_items
SET
  health = CASE
    WHEN raw_json ? 'health'
      AND (raw_json->>'health') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (raw_json->>'health')::numeric
    ELSE health
  END,
  tags_json = CASE
    WHEN jsonb_typeof(raw_json->'tags') = 'array' THEN raw_json->'tags'
    ELSE tags_json
  END
WHERE raw_json IS NOT NULL;
