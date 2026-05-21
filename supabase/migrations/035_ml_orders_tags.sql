-- Tags do pedido ML (campo tags em GET /orders/{id}) — ex.: paid, delivered, pack_order, fraud_risk_detected.

ALTER TABLE ml_orders
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_ml_orders_account_tags
  ON ml_orders USING GIN (tags);

COMMENT ON COLUMN ml_orders.tags IS 'Tags da venda no ML (order.tags): paid, delivered, pack_order, no_shipping, fraud_risk_detected, etc.';
