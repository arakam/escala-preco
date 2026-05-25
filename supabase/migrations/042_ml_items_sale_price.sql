-- Preço de venda exibido no ML (GET /items/{id}/sale_price), distinto do preço standard (price).
ALTER TABLE ml_items
  ADD COLUMN IF NOT EXISTS sale_price DECIMAL(20, 2);

COMMENT ON COLUMN ml_items.sale_price IS 'Preço de venda exibido ao comprador (GET /items/{id}/sale_price?context=channel_marketplace)';
COMMENT ON COLUMN ml_items.price IS 'Preço standard cadastrado (GET /items/{id}/prices type=standard)';
