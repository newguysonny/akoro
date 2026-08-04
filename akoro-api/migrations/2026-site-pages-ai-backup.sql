-- =============================================================
-- 2026-site-pages-ai-backup.sql
-- Undo for the AI website sync.
--
-- The sync overwrote mgmt.site_pages.content directly. For a page imported
-- from a website template that column holds a full HTML document, and writing
-- plain model prose over it destroyed the layout with nothing to restore from.
--
-- content_backup keeps the page as it was BEFORE its first AI sync, so the
-- sync can always be reverted.
--
-- Idempotent; safe to re-run.
-- =============================================================

ALTER TABLE mgmt.site_pages ADD COLUMN IF NOT EXISTS content_backup text;
ALTER TABLE mgmt.site_pages ADD COLUMN IF NOT EXISTS ai_synced_at   timestamptz;

NOTIFY pgrst, 'reload schema';
