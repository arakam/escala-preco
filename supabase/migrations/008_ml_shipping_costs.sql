-- Tabela de custos de envio do Mercado Livre para MercadoLíderes/reputação verde
-- Fonte: https://www.mercadolivre.com.br/ajuda/40538
-- Válido para: Agências do Mercado Livre, Envios com Coleta e Full

CREATE TABLE IF NOT EXISTS ml_shipping_cost_ranges (
  id SERIAL PRIMARY KEY,
  weight_min_kg NUMERIC(6, 3) NOT NULL,
  weight_max_kg NUMERIC(6, 3),
  weight_label TEXT NOT NULL,
  cost_under_79 NUMERIC(8, 2) NOT NULL,
  cost_79_to_99 NUMERIC(8, 2) NOT NULL,
  cost_100_to_119 NUMERIC(8, 2) NOT NULL,
  cost_120_to_149 NUMERIC(8, 2) NOT NULL,
  cost_150_to_199 NUMERIC(8, 2) NOT NULL,
  cost_200_plus NUMERIC(8, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ml_shipping_cost_ranges IS 'Tabela de custos de envio ML para MercadoLíderes/reputação verde';
COMMENT ON COLUMN ml_shipping_cost_ranges.weight_min_kg IS 'Peso mínimo da faixa em kg';
COMMENT ON COLUMN ml_shipping_cost_ranges.weight_max_kg IS 'Peso máximo da faixa em kg (NULL = sem limite)';
COMMENT ON COLUMN ml_shipping_cost_ranges.weight_label IS 'Descrição da faixa de peso';
COMMENT ON COLUMN ml_shipping_cost_ranges.cost_under_79 IS 'Custo para produtos < R$79 (ou usados)';
COMMENT ON COLUMN ml_shipping_cost_ranges.cost_79_to_99 IS 'Custo para produtos de R$79 a R$99,99';
COMMENT ON COLUMN ml_shipping_cost_ranges.cost_100_to_119 IS 'Custo para produtos de R$100 a R$119,99';
COMMENT ON COLUMN ml_shipping_cost_ranges.cost_120_to_149 IS 'Custo para produtos de R$120 a R$149,99';
COMMENT ON COLUMN ml_shipping_cost_ranges.cost_150_to_199 IS 'Custo para produtos de R$150 a R$199,99';
COMMENT ON COLUMN ml_shipping_cost_ranges.cost_200_plus IS 'Custo para produtos >= R$200';

-- Inserir dados da tabela oficial do Mercado Livre
INSERT INTO ml_shipping_cost_ranges 
  (weight_min_kg, weight_max_kg, weight_label, cost_under_79, cost_79_to_99, cost_100_to_119, cost_120_to_149, cost_150_to_199, cost_200_plus)
VALUES
  (0, 0.3, 'Até 300 g', 39.90, 11.97, 13.97, 15.96, 17.96, 19.95),
  (0.3, 0.5, 'De 300 g a 500 g', 42.90, 12.87, 15.02, 17.16, 19.31, 21.45),
  (0.5, 1, 'De 500 g a 1 kg', 44.90, 13.47, 15.72, 17.96, 20.21, 22.45),
  (1, 2, 'De 1 kg a 2 kg', 46.90, 14.07, 16.42, 18.76, 21.11, 23.45),
  (2, 3, 'De 2 kg a 3 kg', 49.90, 14.97, 17.47, 19.96, 22.46, 24.95),
  (3, 4, 'De 3 kg a 4 kg', 53.90, 16.17, 18.87, 21.56, 24.26, 26.95),
  (4, 5, 'De 4 kg a 5 kg', 56.90, 17.07, 19.92, 22.76, 25.61, 28.45),
  (5, 9, 'De 5 kg a 9 kg', 88.90, 26.67, 31.12, 35.56, 40.01, 44.45),
  (9, 13, 'De 9 kg a 13 kg', 131.90, 39.57, 46.17, 52.76, 59.36, 65.95),
  (13, 17, 'De 13 kg a 17 kg', 146.90, 44.07, 51.42, 58.76, 66.11, 73.45),
  (17, 23, 'De 17 kg a 23 kg', 171.90, 51.57, 60.17, 68.76, 77.36, 85.95),
  (23, 30, 'De 23 kg a 30 kg', 197.90, 59.37, 69.27, 79.16, 89.06, 98.95),
  (30, 40, 'De 30 kg a 40 kg', 203.90, 61.17, 71.37, 81.56, 91.76, 101.95),
  (40, 50, 'De 40 kg a 50 kg', 210.90, 63.27, 73.82, 84.36, 94.91, 105.45),
  (50, 60, 'De 50 kg a 60 kg', 224.90, 67.47, 78.72, 89.96, 101.21, 112.45),
  (60, 70, 'De 60 kg a 70 kg', 240.90, 72.27, 84.32, 96.36, 108.41, 120.45),
  (70, 80, 'De 70 kg a 80 kg', 251.90, 75.57, 88.17, 100.76, 113.36, 125.95),
  (80, 90, 'De 80 kg a 90 kg', 279.90, 83.97, 97.97, 111.96, 125.96, 139.95),
  (90, 100, 'De 90 kg a 100 kg', 319.90, 95.97, 111.97, 127.96, 143.96, 159.95),
  (100, 125, 'De 100 kg a 125 kg', 357.90, 107.37, 125.27, 143.16, 161.06, 178.95),
  (125, 150, 'De 125 kg a 150 kg', 379.90, 113.97, 132.97, 151.96, 170.96, 189.95),
  (150, NULL, 'Maior que 150 kg', 498.90, 149.67, 174.62, 199.56, 224.51, 249.45);

-- Função para obter o custo de frete baseado no peso e preço do produto
CREATE OR REPLACE FUNCTION get_ml_shipping_cost(
  p_weight_kg NUMERIC,
  p_product_price NUMERIC
)
RETURNS NUMERIC AS $$
DECLARE
  v_cost NUMERIC;
BEGIN
  SELECT 
    CASE 
      WHEN p_product_price < 79 THEN cost_under_79
      WHEN p_product_price < 100 THEN cost_79_to_99
      WHEN p_product_price < 120 THEN cost_100_to_119
      WHEN p_product_price < 150 THEN cost_120_to_149
      WHEN p_product_price < 200 THEN cost_150_to_199
      ELSE cost_200_plus
    END INTO v_cost
  FROM ml_shipping_cost_ranges
  WHERE p_weight_kg >= weight_min_kg 
    AND (weight_max_kg IS NULL OR p_weight_kg < weight_max_kg)
  LIMIT 1;
  
  RETURN COALESCE(v_cost, 0);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_ml_shipping_cost IS 'Retorna o custo de frete ML baseado no peso (kg) e preço do produto (R$)';

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION update_ml_shipping_cost_ranges_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ml_shipping_cost_ranges_updated_at
  BEFORE UPDATE ON ml_shipping_cost_ranges
  FOR EACH ROW
  EXECUTE FUNCTION update_ml_shipping_cost_ranges_updated_at();

-- Índice para busca por peso
CREATE INDEX IF NOT EXISTS idx_ml_shipping_weight ON ml_shipping_cost_ranges(weight_min_kg, weight_max_kg);
