-- Retenção de dados de webhook: log enxuto, deduplicação e limpeza automática.
-- Notificações brutas: 7 dias. Alertas de promoção: 30 dias.

-- Log enxuto (payload completo só em legado; novos inserts omitem raw_payload).
ALTER TABLE ml_webhook_notifications
  ALTER COLUMN raw_payload DROP NOT NULL,
  ALTER COLUMN raw_payload DROP DEFAULT;

-- Limpeza única do histórico acumulado
UPDATE ml_webhook_notifications SET raw_payload = NULL WHERE raw_payload IS NOT NULL;
UPDATE ml_promotion_webhook_alerts SET raw_api = NULL WHERE raw_api IS NOT NULL;

DELETE FROM ml_webhook_notifications
WHERE created_at < now() - interval '7 days';

DELETE FROM ml_promotion_webhook_alerts
WHERE created_at < now() - interval '30 days';

-- Deduplicação de reenvios do ML (por conta + notification_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_webhook_notifications_account_notification
  ON ml_webhook_notifications (account_id, notification_id)
  WHERE notification_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ml_webhook_notifications_created_at
  ON ml_webhook_notifications (created_at);

CREATE INDEX IF NOT EXISTS idx_ml_promo_alerts_created_at
  ON ml_promotion_webhook_alerts (created_at);

-- Purge em lotes (pg_cron ou chamada manual via service role)
CREATE OR REPLACE FUNCTION public.prune_ml_webhook_data(
  p_notifications_days INT DEFAULT 7,
  p_alerts_days INT DEFAULT 30,
  p_batch_size INT DEFAULT 5000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notif_cutoff TIMESTAMPTZ;
  v_alert_cutoff TIMESTAMPTZ;
  v_notif_deleted INT := 0;
  v_alert_deleted INT := 0;
  v_batch INT;
BEGIN
  v_notif_cutoff := now() - make_interval(days => GREATEST(1, p_notifications_days));
  v_alert_cutoff := now() - make_interval(days => GREATEST(1, p_alerts_days));
  p_batch_size := GREATEST(100, LEAST(p_batch_size, 50000));

  LOOP
    DELETE FROM ml_webhook_notifications
    WHERE id IN (
      SELECT id FROM ml_webhook_notifications
      WHERE created_at < v_notif_cutoff
      LIMIT p_batch_size
    );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_notif_deleted := v_notif_deleted + v_batch;
    EXIT WHEN v_batch = 0;
  END LOOP;

  LOOP
    DELETE FROM ml_promotion_webhook_alerts
    WHERE id IN (
      SELECT id FROM ml_promotion_webhook_alerts
      WHERE created_at < v_alert_cutoff
      LIMIT p_batch_size
    );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_alert_deleted := v_alert_deleted + v_batch;
    EXIT WHEN v_batch = 0;
  END LOOP;

  RETURN jsonb_build_object(
    'notifications_deleted', v_notif_deleted,
    'alerts_deleted', v_alert_deleted,
    'notifications_cutoff', v_notif_cutoff,
    'alerts_cutoff', v_alert_cutoff
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prune_ml_webhook_data(INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_ml_webhook_data(INT, INT, INT) TO service_role;
