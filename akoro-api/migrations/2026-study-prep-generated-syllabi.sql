-- =============================================================
-- 2026-study-prep-generated-syllabi.sql
-- Grand Plan §8.7 (D30): Study Prep never fails for lack of a syllabus.
-- When no real syllabus exists for a subject + class, the planner drafts an
-- outline (syllabus.generate); it is checked in code, saved here as
-- PROVISIONAL, reused for the same scope instead of generating again, and
-- always labelled "AI-drafted outline" to the learner. Admins may later
-- promote one into the platform syllabus (promoted_subject_id) or reject it.
-- The session records what it planned against (syllabus_source / _ref).
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.generated_syllabi (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_learner  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  subject             text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 180),
  class_level         text NOT NULL CHECK (char_length(class_level) BETWEEN 1 AND 40),
  exam_board          text,
  term                text,
  topics              jsonb NOT NULL CHECK (jsonb_typeof(topics) = 'array'),   -- [{ id, label, objectives[] }]
  grounding           jsonb,
  model               text,
  prompt_version      text,
  source              text NOT NULL DEFAULT 'generated' CHECK (source IN ('generated', 'documents')),
  record_ids          uuid[],
  status              text NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional', 'promoted', 'rejected')),
  promoted_subject_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- One provisional outline per scope, reused across learners.
CREATE UNIQUE INDEX IF NOT EXISTS uq_generated_syllabi_scope
  ON edu.generated_syllabi (lower(subject), lower(class_level), coalesce(exam_board, ''), coalesce(term, ''))
  WHERE status = 'provisional';

ALTER TABLE edu.study_prep_sessions
  ADD COLUMN IF NOT EXISTS syllabus_source text
    CHECK (syllabus_source IS NULL OR syllabus_source IN ('class', 'school', 'platform', 'generated', 'documents')),
  ADD COLUMN IF NOT EXISTS syllabus_ref uuid;

GRANT SELECT, INSERT, UPDATE, DELETE ON edu.generated_syllabi TO service_role;
NOTIFY pgrst, 'reload schema';
