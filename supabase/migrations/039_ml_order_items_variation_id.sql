-- Variação vendida por linha de pedido (order_items[].item.variation_id no ML).

ALTER TABLE ml_order_items
  ADD COLUMN IF NOT EXISTS variation_id BIGINT;

COMMENT ON COLUMN ml_order_items.variation_id IS 'ID da variação vendida (order_items[].item.variation_id); NULL se item sem variação ou não informado pelo ML';
