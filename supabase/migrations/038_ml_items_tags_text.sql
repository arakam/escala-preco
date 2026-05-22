-- Coluna derivada para filtrar alertas ML com operadores de array (&&, @>) no PostgREST
CREATE OR REPLACE FUNCTION public.ml_tags_json_to_text_array(p_tags jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(lower(btrim(elem)) ORDER BY elem),
    ARRAY[]::text[]
  )
  FROM jsonb_array_elements_text(COALESCE(p_tags, '[]'::jsonb)) AS elem;
$$;

ALTER TABLE ml_items
  ADD COLUMN IF NOT EXISTS tags_text text[] GENERATED ALWAYS AS (ml_tags_json_to_text_array(tags_json)) STORED;

COMMENT ON COLUMN ml_items.tags_text IS 'Tags do ML (text[]) derivadas de tags_json para filtros de alerta';

CREATE INDEX IF NOT EXISTS idx_ml_items_tags_text ON ml_items USING gin (tags_text);
