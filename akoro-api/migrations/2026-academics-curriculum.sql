-- =============================================================
-- 2026-academics-curriculum.sql
-- Academics: Curriculum (school-wide), Scheme of Work (per class),
-- Syllabus (per subject). Idempotent — safe to re-run every deploy.
-- =============================================================

-- ── Curriculum — one or more per school (e.g. national/Cambridge/CBC) ──
CREATE TABLE IF NOT EXISTS mgmt.curricula (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,                         -- e.g. "Nigerian National Curriculum"
  framework   text,                                  -- e.g. "NERDC", "Cambridge", "CBC"
  level_id    uuid REFERENCES mgmt.academic_levels(id)   ON DELETE SET NULL,  -- optional level scope
  session_id  uuid REFERENCES mgmt.academic_sessions(id) ON DELETE SET NULL,
  description text,
  document_url text,                                 -- optional uploaded curriculum doc
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_curricula_school ON mgmt.curricula (school_id);

-- ── Scheme of Work — planned coverage per class (optionally per subject) ──
CREATE TABLE IF NOT EXISTS mgmt.scheme_of_work (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL REFERENCES mgmt.classes(id)  ON DELETE CASCADE,
  subject_id  uuid REFERENCES mgmt.subjects(id) ON DELETE SET NULL,
  term        text,                                  -- First / Second / Third
  week        text,                                  -- e.g. "Week 1"
  topic       text NOT NULL,
  objectives  text,
  activities  text,
  resources   text,
  status      text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','ongoing','completed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scheme_of_work_school ON mgmt.scheme_of_work (school_id);
CREATE INDEX IF NOT EXISTS idx_scheme_of_work_class  ON mgmt.scheme_of_work (class_id);

-- ── Syllabus — outline per subject (optionally scoped to a class) ──
CREATE TABLE IF NOT EXISTS mgmt.subject_syllabus (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  subject_id  uuid NOT NULL REFERENCES mgmt.subjects(id) ON DELETE CASCADE,
  class_id    uuid REFERENCES mgmt.classes(id) ON DELETE SET NULL,   -- optional class scope
  title       text NOT NULL,
  term        text,
  description text,
  document_url text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subject_syllabus_school  ON mgmt.subject_syllabus (school_id);
CREATE INDEX IF NOT EXISTS idx_subject_syllabus_subject ON mgmt.subject_syllabus (subject_id);

NOTIFY pgrst, 'reload schema';
