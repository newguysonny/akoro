-- =============================================================
-- 2026-page-blocks.sql
-- Visual page builder: pages are composed of structured blocks (hero, heading,
-- text, image, button, cards, …). `blocks` holds the editable structure; the
-- existing `content` column keeps the rendered HTML that the site serves.
-- Additive + idempotent.
-- =============================================================

ALTER TABLE mgmt.site_pages ADD COLUMN IF NOT EXISTS blocks jsonb;

NOTIFY pgrst, 'reload schema';
