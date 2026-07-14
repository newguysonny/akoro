-- =============================================================
-- 2026-template-colors.sql
-- Per-school brand colours for template sites: overrides for the active
-- template's CSS custom properties (e.g. --gold), injected into every page
-- at render time. { "--gold": "#1B5E20", ... }. Additive + idempotent.
-- =============================================================

ALTER TABLE edu.school_website ADD COLUMN IF NOT EXISTS template_colors jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
