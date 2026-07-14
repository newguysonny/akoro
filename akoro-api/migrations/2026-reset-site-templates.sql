-- =============================================================
-- 2026-reset-site-templates.sql
-- Website builder reset: remove dead default/sample website template rows.
-- Schema migrations re-run on EVERY deploy, so this must never touch a
-- template a school has (re)installed from the current gallery:
--   • Chrisland / Classic / demo-templates — old samples, always removed.
--   • Vista — remove only OLD broken clones (their import payload pages were
--     stripped body fragments); the current gallery's clones store pages as
--     full <!doctype html> documents and are preserved. This is what keeps a
--     school's ACTIVE template intact across deploys.
-- Schools' own uploaded templates (any other name) are untouched.
-- =============================================================

-- Never delete a template a school currently has ACTIVE (is_active): this
-- migration re-runs on every deploy, and deleting the active template is what
-- was resetting schools' sites. Only inactive dead artefacts are removed.
DELETE FROM edu.school_website_templates
WHERE is_active = false
  AND name IN (
    'Chrisland Schools — School Site',
    'Classic School Site',
    'demo-templates'
  );

DELETE FROM edu.school_website_templates
WHERE is_active = false
  AND name = 'Vista Charter — School Site'
  AND (
    import_payload IS NULL
    OR import_payload->'pages'->0->>'content' NOT ILIKE '<!doctype html%'
  );

-- Remove the old hardcoded sample custom domain the demo seed used to insert.
DELETE FROM edu.school_domains WHERE domain = 'www.akorodemoacademy.com';

NOTIFY pgrst, 'reload schema';
