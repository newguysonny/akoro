-- =============================================================
-- 2026-reset-site-templates.sql
-- Website builder reset: remove every default/sample website template row
-- from the database (per-school clones of the old shared gallery + seeded
-- demo templates). Schools' own uploaded templates (any other name) are
-- untouched. The gallery is rebuilt in code from the new Vista template
-- (defaultTemplates/vista.json), whose import creates full-fidelity pages.
-- Idempotent (plain DELETEs).
-- =============================================================

DELETE FROM edu.school_website_templates
WHERE name IN (
  'Vista Charter — School Site',
  'Chrisland Schools — School Site',
  'Classic School Site',
  'demo-templates'
);

-- Remove the old hardcoded sample custom domain the demo seed used to insert.
-- Real domains are added by schools in Settings → Domain; the base domain is
-- derived from FRONTEND_URL, never stored.
DELETE FROM edu.school_domains WHERE domain = 'www.akorodemoacademy.com';

NOTIFY pgrst, 'reload schema';
