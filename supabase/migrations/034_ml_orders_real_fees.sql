-- Taxa e frete reais do ML (sale_fee no pedido + custo de envio do vendedor em /shipments/.../costs)

ALTER TABLE ml_orders
  ADD COLUMN IF NOT EXISTS shipping_id TEXT,
  ADD COLUMN IF NOT EXISTS shipping_cost_sender NUMERIC,
  ADD COLUMN IF NOT EXISTS marketplace_fee NUMERIC;

ALTER TABLE ml_order_items
  ADD COLUMN IF NOT EXISTS sale_fee NUMERIC;

COMMENT ON COLUMN ml_orders.shipping_id IS 'ID do envio (order.shipping.id); usado em GET /shipments/{id}/costs';
COMMENT ON COLUMN ml_orders.shipping_cost_sender IS 'Frete pago pelo vendedor (senders[].cost em /shipments/{id}/costs)';
COMMENT ON COLUMN ml_orders.marketplace_fee IS 'Comissão total no pagamento (payments[].marketplace_fee), fallback';
COMMENT ON COLUMN ml_order_items.sale_fee IS 'Comissão ML da linha (order_items[].sale_fee)';
