-- Ignora SKUs gerados pelo ML (ex.: CONF-MLB5097086620) na extração e vínculo por SKU.

CREATE OR REPLACE FUNCTION is_ml_placeholder_sku(sku TEXT) RETURNS BOOLEAN AS $$
BEGIN
  IF sku IS NULL OR TRIM(sku) = '' THEN
    RETURN FALSE;
  END IF;
  RETURN UPPER(TRIM(sku)) ~ '^CONF-ML[A-Z]{1,3}[0-9]+$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION extract_sku_from_json(raw JSONB) RETURNS TEXT AS $$
DECLARE
  attr JSONB;
  sku TEXT;
BEGIN
  IF raw->'attributes' IS NOT NULL AND jsonb_typeof(raw->'attributes') = 'array' THEN
    FOR attr IN SELECT * FROM jsonb_array_elements(raw->'attributes')
    LOOP
      IF attr->>'id' IN ('SELLER_SKU', 'SKU', 'CUSTOM_SKU')
         AND COALESCE(attr->>'value_name', '') != '' THEN
        sku := UPPER(TRIM(attr->>'value_name'));
        IF NOT is_ml_placeholder_sku(sku) THEN
          RETURN sku;
        END IF;
      END IF;
    END LOOP;
  END IF;

  sku := raw->>'seller_custom_field';
  IF sku IS NOT NULL AND sku != '' THEN
    sku := UPPER(TRIM(sku));
    IF NOT is_ml_placeholder_sku(sku) THEN
      RETURN sku;
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_ml_placeholder_sku IS 'SKUs automáticos do ML (configurador/catálogo), ex. CONF-MLB123 — não usar como SKU do seller';
