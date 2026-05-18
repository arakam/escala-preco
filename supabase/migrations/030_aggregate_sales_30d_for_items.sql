-- Agregação 30d só para MLB(s) afetados (webhook de pedido).
CREATE OR REPLACE FUNCTION aggregate_ml_item_sales_30d_for_items(
  p_account_id UUID,
  p_item_ids TEXT[]
)
RETURNS TABLE(item_id TEXT, quantity BIGINT, order_count BIGINT)
LANGUAGE sql
STABLE
AS $$
  SELECT
    oi.item_id,
    COALESCE(SUM(oi.quantity), 0)::BIGINT AS quantity,
    COUNT(DISTINCT oi.ml_order_id)::BIGINT AS order_count
  FROM ml_order_items oi
  INNER JOIN ml_orders o
    ON o.account_id = oi.account_id
   AND o.ml_order_id = oi.ml_order_id
  WHERE oi.account_id = p_account_id
    AND oi.item_id = ANY(p_item_ids)
    AND o.status = 'paid'
    AND o.date_created >= (now() - interval '30 days')
  GROUP BY oi.item_id;
$$;
