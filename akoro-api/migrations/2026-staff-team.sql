-- =============================================================
-- 2026-staff-team.sql
-- Staff & Team: categorise staff into academic / non-academic and a named
-- group (Leadership, Class Teacher, …) so the Staff & Team dashboard can list
-- them per group. Additive + idempotent. Run after 2026-mgmt-schema-2.sql.
-- =============================================================

ALTER TABLE mgmt.staff ADD COLUMN IF NOT EXISTS staff_class text;   -- 'academic' | 'non_academic'
ALTER TABLE mgmt.staff ADD COLUMN IF NOT EXISTS staff_group text;   -- e.g. 'Leadership', 'Class Teacher'

CREATE INDEX IF NOT EXISTS idx_staff_class_group ON mgmt.staff (school_id, staff_class, staff_group);

NOTIFY pgrst, 'reload schema';
