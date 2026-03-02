-- Atualização da tabela de custos de envio do Mercado Livre
-- Fonte: https://www.mercadolivre.com.br/ajuda/custos-envio-reputacao-verde-sem-reputacao_48392
-- Válido a partir de: 2 de março de 2026
-- Aplicável para: MercadoLíderes, reputação verde ou sem reputação
-- Modalidades: Envios Full, Coleta e Agências de Mercado Livre

-- A nova tabela tem 8 faixas de preço (antes eram 6):
-- R$ 0 a R$ 18,99
-- R$ 19 a R$ 48,99
-- R$ 49 a R$ 78,99
-- R$ 79 a R$ 99,99
-- R$ 100 a R$ 119,99
-- R$ 120 a R$ 149,99
-- R$ 150 a R$ 199,99
-- A partir de R$ 200

-- Adicionar novas colunas para as faixas de preço adicionais
ALTER TABLE ml_shipping_cost_ranges 
  ADD COLUMN IF NOT EXISTS cost_0_to_18 NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS cost_19_to_48 NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS cost_49_to_78 NUMERIC(8, 2);

-- Renomear colunas existentes para refletir as novas faixas
-- cost_under_79 -> será removida (substituída pelas 3 novas)
-- cost_79_to_99 -> mantém
-- cost_100_to_119 -> mantém
-- cost_120_to_149 -> mantém
-- cost_150_to_199 -> mantém
-- cost_200_plus -> mantém

-- Atualizar comentários das colunas
COMMENT ON COLUMN ml_shipping_cost_ranges.cost_0_to_18 IS 'Custo para produtos de R$0 a R$18,99';
COMMENT ON COLUMN ml_shipping_cost_ranges.cost_19_to_48 IS 'Custo para produtos de R$19 a R$48,99';
COMMENT ON COLUMN ml_shipping_cost_ranges.cost_49_to_78 IS 'Custo para produtos de R$49 a R$78,99';
COMMENT ON COLUMN ml_shipping_cost_ranges.cost_under_79 IS 'DEPRECATED - Use cost_0_to_18, cost_19_to_48, cost_49_to_78';

-- Limpar dados existentes e inserir novos valores
TRUNCATE TABLE ml_shipping_cost_ranges;

INSERT INTO ml_shipping_cost_ranges 
  (weight_min_kg, weight_max_kg, weight_label, cost_0_to_18, cost_19_to_48, cost_49_to_78, cost_under_79, cost_79_to_99, cost_100_to_119, cost_120_to_149, cost_150_to_199, cost_200_plus)
VALUES
  (0, 0.3, 'Até 0,3 kg', 5.65, 6.55, 7.75, 7.75, 12.35, 14.35, 16.45, 18.45, 20.95),
  (0.3, 0.5, 'De 0,3 a 0,5 kg', 5.95, 6.65, 7.85, 7.85, 13.25, 15.45, 17.65, 19.85, 22.55),
  (0.5, 1, 'De 0,5 a 1 kg', 6.05, 6.75, 7.95, 7.95, 13.85, 16.15, 18.45, 20.75, 23.65),
  (1, 1.5, 'De 1 a 1,5 kg', 6.15, 6.85, 8.05, 8.05, 14.15, 16.45, 18.85, 21.15, 24.65),
  (1.5, 2, 'De 1,5 a 2 kg', 6.25, 6.95, 8.15, 8.15, 14.45, 16.85, 19.25, 21.65, 24.65),
  (2, 3, 'De 2 a 3 kg', 6.35, 7.95, 8.55, 8.55, 15.75, 18.35, 21.05, 23.65, 26.25),
  (3, 4, 'De 3 a 4 kg', 6.45, 8.15, 8.95, 8.95, 17.05, 19.85, 22.65, 25.55, 28.35),
  (4, 5, 'De 4 a 5 kg', 6.55, 8.35, 9.75, 9.75, 18.45, 21.55, 24.65, 27.75, 30.75),
  (5, 6, 'De 5 a 6 kg', 6.65, 8.55, 9.95, 9.95, 25.45, 28.55, 32.65, 35.75, 39.75),
  (6, 7, 'De 6 a 7 kg', 6.75, 8.75, 10.15, 10.15, 27.05, 31.05, 36.05, 40.05, 44.05),
  (7, 8, 'De 7 a 8 kg', 6.85, 8.95, 10.35, 10.35, 28.85, 33.65, 38.45, 43.25, 48.05),
  (8, 9, 'De 8 a 9 kg', 6.95, 9.15, 10.55, 10.55, 29.65, 34.55, 39.55, 44.45, 49.35),
  (9, 11, 'De 9 a 11 kg', 7.05, 9.55, 10.95, 10.95, 41.25, 48.05, 54.95, 61.75, 68.65),
  (11, 13, 'De 11 a 13 kg', 7.15, 9.95, 11.35, 11.35, 42.15, 49.25, 56.25, 63.25, 70.25),
  (13, 15, 'De 13 a 15 kg', 7.25, 10.15, 11.55, 11.55, 45.05, 52.45, 59.95, 67.45, 74.95),
  (15, 17, 'De 15 a 17 kg', 7.35, 10.35, 11.75, 11.75, 48.55, 56.05, 63.55, 70.75, 78.65),
  (17, 20, 'De 17 a 20 kg', 7.45, 10.55, 11.95, 11.95, 54.75, 63.85, 72.95, 82.05, 91.15),
  (20, 25, 'De 20 a 25 kg', 7.65, 10.95, 12.15, 12.15, 64.05, 75.05, 84.75, 95.35, 105.95),
  (25, 30, 'De 25 a 30 kg', 7.75, 11.15, 12.35, 12.35, 65.95, 75.45, 85.55, 96.25, 106.95),
  (30, 40, 'De 30 a 40 kg', 7.85, 11.35, 12.55, 12.55, 67.75, 78.95, 88.95, 99.15, 107.05),
  (40, 50, 'De 40 a 50 kg', 7.95, 11.55, 12.75, 12.75, 70.25, 81.05, 92.05, 102.55, 110.75),
  (50, 60, 'De 50 a 60 kg', 8.05, 11.75, 12.95, 12.95, 74.95, 86.45, 98.15, 109.35, 118.15),
  (60, 70, 'De 60 a 70 kg', 8.15, 11.95, 13.15, 13.15, 80.25, 92.95, 105.05, 117.15, 126.55),
  (70, 80, 'De 70 a 80 kg', 8.25, 12.15, 13.35, 13.35, 83.95, 97.05, 109.85, 122.45, 132.25),
  (80, 90, 'De 80 a 90 kg', 8.35, 12.35, 13.55, 13.55, 93.25, 107.45, 122.05, 136.05, 146.95),
  (90, 100, 'De 90 a 100 kg', 8.45, 12.55, 13.75, 13.75, 106.55, 123.95, 139.55, 155.55, 167.95),
  (100, 125, 'De 100 a 125 kg', 8.55, 12.75, 13.95, 13.95, 119.25, 138.05, 156.05, 173.95, 187.95),
  (125, 150, 'De 125 a 150 kg', 8.65, 12.75, 14.15, 14.15, 126.55, 146.15, 165.65, 184.65, 199.45),
  (150, NULL, 'Mais de 150 kg', 8.75, 12.95, 14.35, 14.35, 166.15, 192.45, 217.55, 242.55, 261.95);

-- Atualizar a função para usar as novas faixas de preço
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
      WHEN p_product_price < 19 THEN cost_0_to_18
      WHEN p_product_price < 49 THEN cost_19_to_48
      WHEN p_product_price < 79 THEN cost_49_to_78
      WHEN p_product_price < 100 THEN cost_79_to_99
      WHEN p_product_price < 120 THEN cost_100_to_119
      WHEN p_product_price < 150 THEN cost_120_to_149
      WHEN p_product_price < 200 THEN cost_150_to_199
      ELSE cost_200_plus
    END INTO v_cost
  FROM ml_shipping_cost_ranges
  WHERE p_weight_kg >= weight_min_kg 
    AND (weight_max_kg IS NULL OR p_weight_kg < weight_max_kg)
  ORDER BY weight_min_kg
  LIMIT 1;
  
  -- Para produtos abaixo de R$19, o custo máximo é metade do preço do produto
  IF p_product_price < 19 AND v_cost > (p_product_price / 2) THEN
    v_cost := p_product_price / 2;
  END IF;
  
  RETURN COALESCE(v_cost, 0);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_ml_shipping_cost IS 'Retorna o custo de frete ML baseado no peso (kg) e preço do produto (R$). Atualizado em março/2026.';

-- Tabela auxiliar para custos de frete grátis e rápido (opcional para produtos < R$79)
CREATE TABLE IF NOT EXISTS ml_shipping_cost_free_fast (
  id SERIAL PRIMARY KEY,
  weight_min_kg NUMERIC(6, 3) NOT NULL,
  weight_max_kg NUMERIC(6, 3),
  weight_label TEXT NOT NULL,
  cost_under_79 NUMERIC(8, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE ml_shipping_cost_free_fast IS 'Custos opcionais para oferecer frete grátis e rápido em produtos < R$79';

-- Limpar e inserir dados de frete grátis e rápido
TRUNCATE TABLE ml_shipping_cost_free_fast;

INSERT INTO ml_shipping_cost_free_fast (weight_min_kg, weight_max_kg, weight_label, cost_under_79)
VALUES
  (0, 0.3, 'Até 0,3 kg', 12.35),
  (0.3, 0.5, 'De 0,3 a 0,5 kg', 13.25),
  (0.5, 1, 'De 0,5 a 1 kg', 13.85),
  (1, 1.5, 'De 1 a 1,5 kg', 14.15),
  (1.5, 2, 'De 1,5 a 2 kg', 14.45),
  (2, 3, 'De 2 a 3 kg', 15.75),
  (3, 4, 'De 3 a 4 kg', 17.05),
  (4, 5, 'De 4 a 5 kg', 18.45),
  (5, 6, 'De 5 a 6 kg', 25.45),
  (6, 7, 'De 6 a 7 kg', 27.05),
  (7, 8, 'De 7 a 8 kg', 28.85),
  (8, 9, 'De 8 a 9 kg', 29.65),
  (9, 11, 'De 9 a 11 kg', 41.25),
  (11, 13, 'De 11 a 13 kg', 42.15),
  (13, 15, 'De 13 a 15 kg', 45.05),
  (15, 17, 'De 15 a 17 kg', 48.55),
  (17, 20, 'De 17 a 20 kg', 54.75),
  (20, 25, 'De 20 a 25 kg', 64.05),
  (25, 30, 'De 25 a 30 kg', 65.95),
  (30, 40, 'De 30 a 40 kg', 67.75),
  (40, 50, 'De 40 a 50 kg', 70.25),
  (50, 60, 'De 50 a 60 kg', 74.95),
  (60, 70, 'De 60 a 70 kg', 80.25),
  (70, 80, 'De 70 a 80 kg', 83.95),
  (80, 90, 'De 80 a 90 kg', 93.25),
  (90, 100, 'De 90 a 100 kg', 106.55),
  (100, 125, 'De 100 a 125 kg', 119.25),
  (125, 150, 'De 125 a 150 kg', 126.55),
  (150, NULL, 'Mais de 150 kg', 166.15);

-- Função para obter custo de frete grátis e rápido (para produtos < R$79)
CREATE OR REPLACE FUNCTION get_ml_shipping_cost_free_fast(
  p_weight_kg NUMERIC
)
RETURNS NUMERIC AS $$
DECLARE
  v_cost NUMERIC;
BEGIN
  SELECT cost_under_79 INTO v_cost
  FROM ml_shipping_cost_free_fast
  WHERE p_weight_kg >= weight_min_kg 
    AND (weight_max_kg IS NULL OR p_weight_kg < weight_max_kg)
  ORDER BY weight_min_kg
  LIMIT 1;
  
  RETURN COALESCE(v_cost, 0);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_ml_shipping_cost_free_fast IS 'Retorna o custo para oferecer frete grátis e rápido em produtos < R$79';

-- Trigger para atualizar updated_at na nova tabela
CREATE TRIGGER ml_shipping_cost_free_fast_updated_at
  BEFORE UPDATE ON ml_shipping_cost_free_fast
  FOR EACH ROW
  EXECUTE FUNCTION update_ml_shipping_cost_ranges_updated_at();

-- Índice para busca por peso na nova tabela
CREATE INDEX IF NOT EXISTS idx_ml_shipping_free_fast_weight ON ml_shipping_cost_free_fast(weight_min_kg, weight_max_kg);
