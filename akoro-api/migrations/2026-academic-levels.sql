-- =============================================================
-- 2026-academic-levels.sql
-- Academic Levels → Classes → Sections hierarchy for Student Information.
-- Adds a new academic_levels table and links classes to a level; enriches
-- classes and sections with teacher / status / capacity. Additive + idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS mgmt.academic_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS academic_levels_school_idx ON mgmt.academic_levels (school_id, sort_order);

-- Classes gain a parent level, a class teacher (free text) and a status.
ALTER TABLE mgmt.classes  ADD COLUMN IF NOT EXISTS level_id uuid REFERENCES mgmt.academic_levels(id) ON DELETE SET NULL;
ALTER TABLE mgmt.classes  ADD COLUMN IF NOT EXISTS teacher text;
ALTER TABLE mgmt.classes  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'));

-- Sections gain a section teacher, a capacity and a status.
ALTER TABLE mgmt.sections ADD COLUMN IF NOT EXISTS teacher text;
ALTER TABLE mgmt.sections ADD COLUMN IF NOT EXISTS capacity integer;
ALTER TABLE mgmt.sections ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'));

GRANT ALL ON ALL TABLES    IN SCHEMA mgmt TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA mgmt TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
