-- PMA (Preço Mínimo Anunciado) em R$ por produto
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pma NUMERIC(12, 2);

COMMENT ON COLUMN products.pma IS 'PMA — Preço Mínimo Anunciado em R$';
