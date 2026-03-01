-- Tabela de produtos cadastrados pelo usuário
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  ean TEXT,
  height NUMERIC(10, 2),
  width NUMERIC(10, 2),
  length NUMERIC(10, 2),
  weight NUMERIC(10, 3),
  cost_price NUMERIC(12, 2),
  sale_price NUMERIC(12, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, sku)
);

COMMENT ON TABLE products IS 'Cadastro de produtos do usuário';
COMMENT ON COLUMN products.sku IS 'Código SKU único do produto por usuário';
COMMENT ON COLUMN products.title IS 'Título/nome do produto';
COMMENT ON COLUMN products.description IS 'Descrição detalhada do produto';
COMMENT ON COLUMN products.ean IS 'Código de barras EAN/GTIN';
COMMENT ON COLUMN products.height IS 'Altura em cm';
COMMENT ON COLUMN products.width IS 'Largura em cm';
COMMENT ON COLUMN products.length IS 'Comprimento em cm';
COMMENT ON COLUMN products.weight IS 'Peso em kg';
COMMENT ON COLUMN products.cost_price IS 'Preço de custo em R$';
COMMENT ON COLUMN products.sale_price IS 'Preço de venda em R$';

CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(user_id, sku);
CREATE INDEX IF NOT EXISTS idx_products_ean ON products(user_id, ean) WHERE ean IS NOT NULL;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own products"
  ON products FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own products"
  ON products FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own products"
  ON products FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own products"
  ON products FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW
  EXECUTE FUNCTION update_products_updated_at();
