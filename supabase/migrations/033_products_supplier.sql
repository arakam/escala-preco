-- Nome do fornecedor (texto livre)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS supplier TEXT;

COMMENT ON COLUMN products.supplier IS 'Nome do fornecedor (texto livre)';
