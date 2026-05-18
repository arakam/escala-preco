-- Pedidos ML persistidos (carga inicial 30d + webhooks). Agregação para pricing_cache.orders_30d / sales_30d.

CREATE TABLE IF NOT EXISTS ml_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ml_order_id TEXT NOT NULL,
  status TEXT NOT NULL,
  date_created TIMESTAMPTZ NOT NULL,
  date_last_updated TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, ml_order_id)
);

CREATE INDEX IF NOT EXISTS idx_ml_orders_account_date
  ON ml_orders (account_id, date_created DESC);

CREATE INDEX IF NOT EXISTS idx_ml_orders_account_status_date
  ON ml_orders (account_id, status, date_created DESC);

CREATE TABLE IF NOT EXISTS ml_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES ml_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ml_order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  line_index INT NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, ml_order_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_ml_order_items_account_item
  ON ml_order_items (account_id, item_id);

CREATE INDEX IF NOT EXISTS idx_ml_order_items_account_order
  ON ml_order_items (account_id, ml_order_id);

CREATE TABLE IF NOT EXISTS ml_sales_sync_state (
  account_id UUID PRIMARY KEY REFERENCES ml_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  initial_backfill_status TEXT NOT NULL DEFAULT 'idle',
  initial_backfill_at TIMESTAMPTZ,
  initial_backfill_error TEXT,
  last_webhook_sync_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ml_orders IS 'Pedidos do ML (paid e outros status); atualizado por backfill 30d e webhooks orders_v2.';
COMMENT ON TABLE ml_order_items IS 'Itens por pedido (MLB + quantidade).';
COMMENT ON TABLE ml_sales_sync_state IS 'Estado da carga inicial de vendas por conta.';

ALTER TABLE ml_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_sales_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own ml orders"
  ON ml_orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users read own ml order items"
  ON ml_order_items FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users read own ml sales sync state"
  ON ml_sales_sync_state FOR SELECT
  USING (auth.uid() = user_id);

-- Agregação rolling 30d (pedidos pagos) para tela de preços.
CREATE OR REPLACE FUNCTION aggregate_ml_item_sales_30d(p_account_id UUID)
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
    AND o.status = 'paid'
    AND o.date_created >= (now() - interval '30 days')
  GROUP BY oi.item_id;
$$;
