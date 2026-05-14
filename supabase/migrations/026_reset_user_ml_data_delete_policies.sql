-- Políticas DELETE em tabelas derivadas do ML: necessárias para CASCADE ao remover ml_accounts
-- e para o reset local (POST /api/dev/reset-user-data) com cliente autenticado.

DROP POLICY IF EXISTS "Users delete own ml webhook notifications" ON ml_webhook_notifications;
CREATE POLICY "Users delete own ml webhook notifications"
  ON ml_webhook_notifications FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own promotion webhook alerts" ON ml_promotion_webhook_alerts;
CREATE POLICY "Users delete own promotion webhook alerts"
  ON ml_promotion_webhook_alerts FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own ml_job_logs via job" ON ml_job_logs;
CREATE POLICY "Users can delete own ml_job_logs via job"
  ON ml_job_logs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM ml_jobs j
      JOIN ml_accounts a ON a.id = j.account_id
      WHERE j.id = ml_job_logs.job_id AND a.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete pricing_cache via own account" ON pricing_cache;
CREATE POLICY "Users can delete pricing_cache via own account"
  ON pricing_cache FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM ml_accounts ma
      WHERE ma.id = pricing_cache.account_id AND ma.user_id = auth.uid()
    )
  );
