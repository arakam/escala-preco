-- Adicionar campo de despesas fixas (valor em R$) na tabela de produtos
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fixed_expenses NUMERIC(12, 2);

COMMENT ON COLUMN products.fixed_expenses IS 'Despesas fixas em R$ (descontadas no cálculo do valor líquido, junto com taxa extra)';
