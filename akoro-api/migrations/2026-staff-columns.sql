-- =============================================================
-- 2026-staff-columns.sql
-- Extra staff profile columns for the Staff & Team directory:
--   duty                what they do (e.g. 'Geography/SOS', 'Principal')
--   qualification       degrees/certs text (e.g. 'NCE 1993, B.Ed 1998, M.A. Ed 2015')
--   experience_years    years of experience
--   year_of_graduation  primary graduation year (e.g. 2012)
-- (Photos already use the existing mgmt.staff.photo_url column.)
-- Additive + idempotent. Run after 2026-staff-team.sql.
-- =============================================================

ALTER TABLE mgmt.staff ADD COLUMN IF NOT EXISTS duty               text;
ALTER TABLE mgmt.staff ADD COLUMN IF NOT EXISTS qualification      text;
ALTER TABLE mgmt.staff ADD COLUMN IF NOT EXISTS experience_years   int;
ALTER TABLE mgmt.staff ADD COLUMN IF NOT EXISTS year_of_graduation int;

NOTIFY pgrst, 'reload schema';
