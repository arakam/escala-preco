-- DELETE para reset local e CASCADE via ml_accounts.

DROP POLICY IF EXISTS "Users delete own ml orders" ON ml_orders;
CREATE POLICY "Users delete own ml orders"
  ON ml_orders FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own ml order items" ON ml_order_items;
CREATE POLICY "Users delete own ml order items"
  ON ml_order_items FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own ml sales sync state" ON ml_sales_sync_state;
CREATE POLICY "Users delete own ml sales sync state"
  ON ml_sales_sync_state FOR DELETE
  USING (auth.uid() = user_id);
