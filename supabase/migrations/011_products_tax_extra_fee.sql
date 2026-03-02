-- Adicionar campos de imposto e taxa extra na tabela de produtos
ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS tax_percent NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS extra_fee_percent NUMERIC(5, 2);

COMMENT ON COLUMN products.tax_percent IS 'Percentual de imposto sobre o produto (ex: 10.5 = 10,5%)';
COMMENT ON COLUMN products.extra_fee_percent IS 'Percentual de taxa extra (ex: 5.0 = 5%)';
