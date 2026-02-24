-- Campos User Product (UP) / MLBU: itens do modelo "Price per Variation" têm user_product_id, family_id, family_name.
-- Permite identificar e tratar corretamente anúncios clássicos vs User Product na sincronização e atualização.
ALTER TABLE ml_items
  ADD COLUMN IF NOT EXISTS user_product_id TEXT,
  ADD COLUMN IF NOT EXISTS family_id TEXT,
  ADD COLUMN IF NOT EXISTS family_name TEXT;

COMMENT ON COLUMN ml_items.user_product_id IS 'ID do User Product (UP) no modelo MLBU/Price per Variation; NULL para itens do modelo clássico';
COMMENT ON COLUMN ml_items.family_id IS 'ID da família de User Products; NULL para itens do modelo clássico';
COMMENT ON COLUMN ml_items.family_name IS 'Nome da família (título genérico do produto) no modelo UP; NULL para itens clássicos';

CREATE INDEX IF NOT EXISTS idx_ml_items_user_product_id ON ml_items(account_id, user_product_id) WHERE user_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ml_items_family_id ON ml_items(account_id, family_id) WHERE family_id IS NOT NULL;
