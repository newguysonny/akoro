-- =============================================================
-- 2026-reset-site-templates.sql
-- Website builder reset: remove dead default/sample website template rows.
-- Schema migrations re-run on EVERY deploy, so this must never touch a
-- template a school has (re)installed from the current gallery:
--   • Chrisland / Classic / demo-templates — old samples, always removed.
--   • Vista — withdrawn from the gallery; every inactive clone is removed.
--     ACTIVE clones are preserved, which is what keeps a school's live site
--     intact across deploys.
-- Schools' own uploaded templates (any other name) are untouched.
-- =============================================================

-- Never delete a template a school currently has ACTIVE (is_active): this
-- migration re-runs on every deploy, and deleting the active template is what
-- was resetting schools' sites. Only inactive dead artefacts are removed.
-- NOTE: 'Classic School Site' is intentionally NOT deleted here. The demo seed
-- (2026-seed-site.sql) uses the existence of that template row as its
-- "already seeded — skip destructive cleanup" sentinel. Deleting it made the
-- seed's guard misfire on the next deploy, which then wiped the school's live
-- home page (slug 'home') — including an active template's imported home.
-- Leaving the row intact keeps that guard stable across redeploys.
DELETE FROM edu.school_website_templates
WHERE is_active = false
  AND name IN (
    'Chrisland Schools — School Site',
    'demo-templates'
  );

-- Vista has been withdrawn from the gallery (the code default was deleted), so
-- every INACTIVE clone goes with it. Active clones are still left alone: a
-- school running Vista keeps its site until it chooses another template.
DELETE FROM edu.school_website_templates
WHERE is_active = false
  AND name = 'Vista Charter — School Site';

-- Remove the old hardcoded sample custom domain the demo seed used to insert.
DELETE FROM edu.school_domains WHERE domain = 'www.akorodemoacademy.com';

NOTIFY pgrst, 'reload schema';
