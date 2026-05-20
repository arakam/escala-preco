-- Tags de produto (rótulos livres por usuário, ex.: full, queima estoque)

CREATE TABLE IF NOT EXISTS product_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE product_tags IS 'Tags/rótulos criados pelo usuário para classificar produtos';
COMMENT ON COLUMN product_tags.name IS 'Nome exibido da tag (único por usuário, case-insensitive)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_tags_user_name_lower
  ON product_tags (user_id, lower(trim(name)));

CREATE INDEX IF NOT EXISTS idx_product_tags_user_id ON product_tags(user_id);

CREATE TABLE IF NOT EXISTS product_tag_assignments (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES product_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, tag_id)
);

COMMENT ON TABLE product_tag_assignments IS 'Associação N:N entre produtos e tags';

CREATE INDEX IF NOT EXISTS idx_product_tag_assignments_tag ON product_tag_assignments(tag_id);
CREATE INDEX IF NOT EXISTS idx_product_tag_assignments_product ON product_tag_assignments(product_id);

ALTER TABLE product_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_tag_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own product tags"
  ON product_tags FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own product tags"
  ON product_tags FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own product tags"
  ON product_tags FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own product tags"
  ON product_tags FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own tag assignments"
  ON product_tag_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_tag_assignments.product_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own tag assignments"
  ON product_tag_assignments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_tag_assignments.product_id AND p.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM product_tags t
      WHERE t.id = product_tag_assignments.tag_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own tag assignments"
  ON product_tag_assignments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_tag_assignments.product_id AND p.user_id = auth.uid()
    )
  );
