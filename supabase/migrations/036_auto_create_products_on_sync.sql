-- Criar/atualizar produtos automaticamente após sincronizar anúncios (SKU + peso + medidas).

ALTER TABLE ml_accounts
  ADD COLUMN IF NOT EXISTS auto_create_products_on_sync BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN ml_accounts.auto_create_products_on_sync IS
  'Quando true, após sync/import de anúncios cria ou atualiza produtos com SKU, altura, largura, comprimento e peso do ML e vincula MLB.';
