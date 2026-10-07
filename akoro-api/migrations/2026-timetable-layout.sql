-- =============================================================
-- 2026-timetable-layout.sql
-- Richer class timetable: optional "A or B" subject per slot + a per-class
-- timetable meta block (prepared/approved by, head of curriculum, approved
-- badge) to match the printed timetable layout. Idempotent.
-- =============================================================

-- Optional second subject for "X or Y" optional-subject cells.
ALTER TABLE mgmt.timetable_slots
  ADD COLUMN IF NOT EXISTS alt_subject_id uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL;

-- Per-class (optionally per-section) timetable header/footer metadata.
CREATE TABLE IF NOT EXISTS mgmt.timetable_meta (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  class_id             uuid NOT NULL REFERENCES mgmt.classes(id) ON DELETE CASCADE,
  section_id           uuid REFERENCES mgmt.sections(id) ON DELETE CASCADE,
  title                text,                    -- e.g. "GRADE 7 TIMETABLE"
  prepared_by          text,
  approved_by          text,
  head_of_curriculum   text,
  approved             boolean NOT NULL DEFAULT false,
  approved_on          date,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, section_id)
);
CREATE INDEX IF NOT EXISTS idx_timetable_meta_school ON mgmt.timetable_meta (school_id);

NOTIFY pgrst, 'reload schema';
