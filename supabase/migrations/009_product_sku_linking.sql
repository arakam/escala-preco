-- Vinculação de anúncios/variações ML com produtos cadastrados via SKU
-- Permite relacionar preços e contar quantos anúncios existem por SKU

-- Adiciona referência ao produto na tabela de itens
ALTER TABLE ml_items
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;

COMMENT ON COLUMN ml_items.product_id IS 'Referência ao produto cadastrado (via SKU); permite relacionar preços e métricas';

CREATE INDEX IF NOT EXISTS idx_ml_items_product_id ON ml_items(product_id) WHERE product_id IS NOT NULL;

-- Adiciona referência ao produto na tabela de variações
ALTER TABLE ml_variations
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;

COMMENT ON COLUMN ml_variations.product_id IS 'Referência ao produto cadastrado (via SKU); permite relacionar preços e métricas';

CREATE INDEX IF NOT EXISTS idx_ml_variations_product_id ON ml_variations(product_id) WHERE product_id IS NOT NULL;

-- Função auxiliar para extrair SKU do raw_json (item ou variação)
-- Busca no array attributes por SELLER_SKU (fonte principal)
-- Fallback para seller_custom_field se existir
CREATE OR REPLACE FUNCTION extract_sku_from_json(raw JSONB) RETURNS TEXT AS $$
DECLARE
  attr JSONB;
  sku TEXT;
BEGIN
  -- 1. Busca no array attributes por SELLER_SKU (fonte principal)
  IF raw->'attributes' IS NOT NULL AND jsonb_typeof(raw->'attributes') = 'array' THEN
    FOR attr IN SELECT * FROM jsonb_array_elements(raw->'attributes')
    LOOP
      IF attr->>'id' = 'SELLER_SKU' AND COALESCE(attr->>'value_name', '') != '' THEN
        RETURN UPPER(TRIM(attr->>'value_name'));
      END IF;
    END LOOP;
  END IF;
  
  -- 2. Fallback: seller_custom_field (raramente usado)
  sku := raw->>'seller_custom_field';
  IF sku IS NOT NULL AND sku != '' THEN
    RETURN UPPER(TRIM(sku));
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Aliases para compatibilidade
CREATE OR REPLACE FUNCTION extract_item_sku(raw JSONB) RETURNS TEXT AS $$
BEGIN
  RETURN extract_sku_from_json(raw);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION extract_variation_sku(raw JSONB) RETURNS TEXT AS $$
BEGIN
  RETURN extract_sku_from_json(raw);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Função para vincular automaticamente anúncios/variações ao produto pelo SKU
-- Busca correspondência extraindo SKU do raw_json
CREATE OR REPLACE FUNCTION link_ml_items_to_products(p_user_id UUID)
RETURNS TABLE(
  items_linked INTEGER,
  variations_linked INTEGER
) AS $$
DECLARE
  v_items_linked INTEGER := 0;
  v_variations_linked INTEGER := 0;
BEGIN
  -- Vincula ml_items onde SKU extraído corresponde ao SKU do produto
  WITH updated_items AS (
    UPDATE ml_items mi
    SET product_id = p.id
    FROM ml_accounts ma, products p
    WHERE mi.account_id = ma.id
      AND ma.user_id = p_user_id
      AND p.user_id = p_user_id
      AND mi.raw_json IS NOT NULL
      AND extract_item_sku(mi.raw_json) = UPPER(TRIM(p.sku))
      AND mi.product_id IS DISTINCT FROM p.id
    RETURNING mi.id
  )
  SELECT COUNT(*) INTO v_items_linked FROM updated_items;

  -- Vincula ml_variations onde SKU extraído corresponde ao SKU do produto
  WITH updated_variations AS (
    UPDATE ml_variations mv
    SET product_id = p.id
    FROM ml_accounts ma, products p
    WHERE mv.account_id = ma.id
      AND ma.user_id = p_user_id
      AND p.user_id = p_user_id
      AND mv.raw_json IS NOT NULL
      AND extract_variation_sku(mv.raw_json) = UPPER(TRIM(p.sku))
      AND mv.product_id IS DISTINCT FROM p.id
    RETURNING mv.id
  )
  SELECT COUNT(*) INTO v_variations_linked FROM updated_variations;

  RETURN QUERY SELECT v_items_linked, v_variations_linked;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para desvincular produto de todos os anúncios/variações
CREATE OR REPLACE FUNCTION unlink_product_from_ml(p_product_id UUID)
RETURNS TABLE(
  items_unlinked INTEGER,
  variations_unlinked INTEGER
) AS $$
DECLARE
  v_items_unlinked INTEGER := 0;
  v_variations_unlinked INTEGER := 0;
BEGIN
  WITH updated_items AS (
    UPDATE ml_items
    SET product_id = NULL
    WHERE product_id = p_product_id
    RETURNING id
  )
  SELECT COUNT(*) INTO v_items_unlinked FROM updated_items;

  WITH updated_variations AS (
    UPDATE ml_variations
    SET product_id = NULL
    WHERE product_id = p_product_id
    RETURNING id
  )
  SELECT COUNT(*) INTO v_variations_unlinked FROM updated_variations;

  RETURN QUERY SELECT v_items_unlinked, v_variations_unlinked;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View para estatísticas de produtos com contagem de anúncios
CREATE OR REPLACE VIEW product_listing_stats AS
SELECT 
  p.id AS product_id,
  p.user_id,
  p.sku,
  p.title,
  p.cost_price,
  p.sale_price,
  COUNT(DISTINCT mi.id) AS total_items,
  COUNT(DISTINCT mv.id) AS total_variations,
  COUNT(DISTINCT mi.id) + COUNT(DISTINCT mv.id) AS total_listings,
  COUNT(DISTINCT mi.id) FILTER (WHERE mi.status = 'active') AS active_items,
  COUNT(DISTINCT mv.id) FILTER (WHERE mv.available_quantity > 0) AS active_variations,
  MIN(mi.price) AS min_item_price,
  MAX(mi.price) AS max_item_price,
  AVG(mi.price) AS avg_item_price,
  SUM(COALESCE(mi.available_quantity, 0)) AS total_available_qty,
  SUM(COALESCE(mi.sold_quantity, 0)) AS total_sold_qty
FROM products p
LEFT JOIN ml_items mi ON mi.product_id = p.id
LEFT JOIN ml_variations mv ON mv.product_id = p.id
GROUP BY p.id, p.user_id, p.sku, p.title, p.cost_price, p.sale_price;

COMMENT ON VIEW product_listing_stats IS 'Estatísticas de anúncios por produto: contagem, preços, quantidades';

-- View para anúncios não vinculados (orphans) - útil para identificar SKUs não cadastrados
CREATE OR REPLACE VIEW unlinked_ml_listings AS
SELECT 
  ma.user_id,
  ma.ml_nickname AS account_nickname,
  'item' AS listing_type,
  mi.item_id,
  NULL::BIGINT AS variation_id,
  mi.title,
  extract_item_sku(mi.raw_json) AS sku,
  mi.price,
  mi.status,
  mi.available_quantity
FROM ml_items mi
JOIN ml_accounts ma ON ma.id = mi.account_id
WHERE mi.product_id IS NULL
  AND extract_item_sku(mi.raw_json) IS NOT NULL

UNION ALL

SELECT 
  ma.user_id,
  ma.ml_nickname AS account_nickname,
  'variation' AS listing_type,
  mv.item_id,
  mv.variation_id,
  NULL AS title,
  extract_variation_sku(mv.raw_json) AS sku,
  mv.price,
  NULL AS status,
  mv.available_quantity
FROM ml_variations mv
JOIN ml_accounts ma ON ma.id = mv.account_id
WHERE mv.product_id IS NULL
  AND extract_variation_sku(mv.raw_json) IS NOT NULL;

COMMENT ON VIEW unlinked_ml_listings IS 'Anúncios/variações com SKU preenchido mas sem produto vinculado';

-- Função RPC para obter SKUs únicos não cadastrados (sugestão de novos produtos)
CREATE OR REPLACE FUNCTION get_unregistered_skus(p_user_id UUID)
RETURNS TABLE(
  sku TEXT,
  listing_count BIGINT,
  sample_title TEXT
) AS $$
BEGIN
  RETURN QUERY
  WITH all_skus AS (
    SELECT 
      extract_item_sku(mi.raw_json) AS normalized_sku,
      mi.title AS sample_title
    FROM ml_items mi
    JOIN ml_accounts ma ON ma.id = mi.account_id
    WHERE ma.user_id = p_user_id
      AND mi.product_id IS NULL
      AND extract_item_sku(mi.raw_json) IS NOT NULL
    
    UNION ALL
    
    SELECT 
      extract_variation_sku(mv.raw_json) AS normalized_sku,
      NULL AS sample_title
    FROM ml_variations mv
    JOIN ml_accounts ma ON ma.id = mv.account_id
    WHERE ma.user_id = p_user_id
      AND mv.product_id IS NULL
      AND extract_variation_sku(mv.raw_json) IS NOT NULL
  )
  SELECT 
    a.normalized_sku AS sku,
    COUNT(*) AS listing_count,
    MAX(a.sample_title) AS sample_title
  FROM all_skus a
  WHERE a.normalized_sku IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM products p 
      WHERE p.user_id = p_user_id 
      AND UPPER(TRIM(p.sku)) = a.normalized_sku
    )
  GROUP BY a.normalized_sku
  ORDER BY listing_count DESC, a.normalized_sku;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_unregistered_skus IS 'Retorna SKUs encontrados em anúncios que não possuem produto cadastrado';
