-- =============================================================
-- 2026-study-prep-materials-goal-type.sql
-- Grand Plan §8.8 (D33): files and non-traditional goals in Study Prep.
--   goal_type              curricular (school / national exam) | non_curricular
--                          (scholarship, competition, professional or course exam,
--                          own topic) — decides the syllabus order
--   material_record_ids    the learner's records the session plans from
--   materials_requested_at learner.request_materials is asked once per session
-- An outline drawn from a learner's own files (syllabus.from_documents) is saved
-- in edu.generated_syllabi with source = 'documents'; it is theirs, so the
-- shared one-provisional-outline-per-scope index now covers drafted outlines
-- only. Idempotent.
-- =============================================================
ALTER TABLE edu.study_prep_sessions
  ADD COLUMN IF NOT EXISTS goal_type text NOT NULL DEFAULT 'curricular',
  ADD COLUMN IF NOT EXISTS material_record_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS materials_requested_at timestamptz;

DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'study_prep_sessions_goal_type_check') THEN
    ALTER TABLE edu.study_prep_sessions
      ADD CONSTRAINT study_prep_sessions_goal_type_check CHECK (goal_type IN ('curricular', 'non_curricular'));
  END IF;
END $c$;

-- Drafted outlines are shared by scope; documents outlines are per learner + folder.
DROP INDEX IF EXISTS edu.uq_generated_syllabi_scope;
CREATE UNIQUE INDEX IF NOT EXISTS uq_generated_syllabi_scope_generated
  ON edu.generated_syllabi (lower(subject), lower(class_level), coalesce(exam_board, ''), coalesce(term, ''))
  WHERE status = 'provisional' AND source = 'generated';
CREATE INDEX IF NOT EXISTS idx_generated_syllabi_documents
  ON edu.generated_syllabi (created_by_learner, (grounding->>'folderId'), created_at DESC)
  WHERE source = 'documents';

NOTIFY pgrst, 'reload schema';
