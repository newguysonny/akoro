-- =============================================================
-- 2026-periods-class-type.sql
-- Periods become class-specific and gain a type (teaching / break / …), so
-- each class can define its own daily schedule. Additive + idempotent.
-- =============================================================

ALTER TABLE mgmt.periods ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES mgmt.classes(id) ON DELETE CASCADE;
ALTER TABLE mgmt.periods ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'teaching';
CREATE INDEX IF NOT EXISTS periods_class_idx ON mgmt.periods (school_id, class_id, sort_order);

NOTIFY pgrst, 'reload schema';
