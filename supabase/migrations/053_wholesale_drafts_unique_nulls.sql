-- Corrige duplicatas de rascunho em itens sem variação (variation_id NULL).
-- No PostgreSQL, UNIQUE(account_id, item_id, variation_id) tratava cada NULL como distinto.

DELETE FROM wholesale_drafts wd
WHERE wd.variation_id IS NULL
  AND wd.id IN (
    SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY account_id, item_id
          ORDER BY updated_at DESC, created_at DESC
        ) AS rn
      FROM wholesale_drafts
      WHERE variation_id IS NULL
    ) ranked
    WHERE rn > 1
  );

ALTER TABLE wholesale_drafts
  DROP CONSTRAINT IF EXISTS wholesale_drafts_account_id_item_id_variation_id_key;

ALTER TABLE wholesale_drafts
  ADD CONSTRAINT wholesale_drafts_account_id_item_id_variation_id_key
  UNIQUE NULLS NOT DISTINCT (account_id, item_id, variation_id);
