-- Tipo de frete / transportadora (GET /shipments/{id} + /carrier na sincronização do pedido).

ALTER TABLE ml_orders
  ADD COLUMN IF NOT EXISTS shipping_logistic_mode TEXT,
  ADD COLUMN IF NOT EXISTS shipping_logistic_type TEXT,
  ADD COLUMN IF NOT EXISTS shipping_carrier TEXT;

COMMENT ON COLUMN ml_orders.shipping_logistic_mode IS 'Modo logístico do envio (shipments.logistic.mode), ex.: me2';
COMMENT ON COLUMN ml_orders.shipping_logistic_type IS 'Tipo logístico (shipments.logistic.type), ex.: drop_off, fulfillment';
COMMENT ON COLUMN ml_orders.shipping_carrier IS 'Transportadora (GET /shipments/{id}/carrier → name)';
