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

NOTIFY pgrst, 'reload schema';
