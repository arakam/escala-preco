-- Datas de entrega/despacho do envio (SLA + lead_time na sincronização).

ALTER TABLE ml_orders
  ADD COLUMN IF NOT EXISTS shipping_delivery_expected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipping_sla_expected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shipping_sla_status TEXT;

COMMENT ON COLUMN ml_orders.shipping_delivery_expected_at IS 'Entrega prevista (lead_time: estimated_delivery_final/time)';
COMMENT ON COLUMN ml_orders.shipping_sla_expected_at IS 'Prazo máximo de despacho (GET /shipments/{id}/sla → expected_date)';
COMMENT ON COLUMN ml_orders.shipping_sla_status IS 'Status SLA do envio: on_time, delayed, early, etc.';
