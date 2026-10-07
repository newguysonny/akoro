-- =============================================================
-- 2026-website-sync-school.sql
-- Website ↔ School Settings sync toggle. When on, the public website's
-- identity fields (hero title, meta title, contact email) follow the
-- school profile automatically, so School Settings edits update the
-- website without re-saving Appearance. Additive + idempotent.
-- =============================================================

ALTER TABLE edu.school_website ADD COLUMN IF NOT EXISTS sync_school_info boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
