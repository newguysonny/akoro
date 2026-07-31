-- =============================================================
-- 2026-vouchers-marketplace-media.sql
-- Richer marketplace listings for the agent app's Discovery-style
-- marketplace: a cover photo, a short pitch, and a category so startups
-- can be browsed by chip like the learner app's subject categories.
-- =============================================================

ALTER TABLE vouchers.startups ADD COLUMN IF NOT EXISTS description     TEXT;
ALTER TABLE vouchers.startups ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE vouchers.startups ADD COLUMN IF NOT EXISTS category        TEXT NOT NULL DEFAULT 'other'
  CHECK (category IN ('education','fintech','gaming','productivity','health','ecommerce','other'));

GRANT ALL ON ALL TABLES    IN SCHEMA vouchers TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vouchers TO service_role;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
