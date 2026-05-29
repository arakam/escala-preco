-- Fase visível durante sync_items (listing, items, fulfillment, products, finishing)
ALTER TABLE ml_jobs ADD COLUMN IF NOT EXISTS phase TEXT;
