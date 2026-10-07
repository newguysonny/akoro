-- =============================================================
-- 2026-template-import.sql
-- Template → builder import: when a zip template is uploaded, the extracted
-- pages (per .html file) and the nav menu are stashed here so "Activate →
-- Import into builder" can create real site_pages + site_menus rows later.
-- Additive + idempotent.
-- =============================================================

ALTER TABLE edu.school_website_templates
  ADD COLUMN IF NOT EXISTS import_payload jsonb;   -- { pages:[{slug,title,content}], menu:[{label,slug|url}] }

NOTIFY pgrst, 'reload schema';
