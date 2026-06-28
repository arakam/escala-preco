-- Update em massa das colunas calculated_* do pricing_cache em UMA query.
-- Antes: a aplicação fazia 1 UPDATE HTTP por linha (centenas por lote = 25-78s).
-- Agora: um único UPDATE ... FROM jsonb_to_recordset por chamada.
CREATE OR REPLACE FUNCTION public.bulk_update_pricing_calculated(
  p_account_id UUID,
  p_rows JSONB,
  p_calculated_at TIMESTAMPTZ DEFAULT now()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  UPDATE pricing_cache pc
  SET
    calculated_price = r.calculated_price,
    calculated_fee = r.calculated_fee,
    calculated_shipping_cost = r.calculated_shipping_cost,
    calculated_at = p_calculated_at
  FROM jsonb_to_recordset(p_rows) AS r(
    item_id TEXT,
    variation_id BIGINT,
    calculated_price NUMERIC,
    calculated_fee NUMERIC,
    calculated_shipping_cost NUMERIC
  )
  WHERE pc.account_id = p_account_id
    AND pc.item_id = r.item_id
    AND pc.variation_id = COALESCE(r.variation_id, -1);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION public.bulk_update_pricing_calculated(UUID, JSONB, TIMESTAMPTZ)
  IS 'Atualiza calculated_price/fee/shipping_cost de várias linhas do pricing_cache em uma única query (payload JSONB).';
