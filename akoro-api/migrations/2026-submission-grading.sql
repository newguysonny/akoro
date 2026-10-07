-- =============================================================
-- 2026-submission-grading.sql
-- Submissions & grading — a teacher grades one learner's work on an
-- assigned activity. The grade lives on the self_study_targets row (the
-- learner's copy of the work), so it travels with everything that already
-- reads targets: the learner's /mine payload, the gradebook, notifications.
--
-- grade        — the published number (0–100); NULL until published.
-- feedback     — the grading draft behind it: written text, rubric levels,
--                mode. Written by autosave-draft publishes, read by the
--                learner and the workbench.
-- graded_at/by — who published, and when.
--
-- Idempotent: guarded column adds, and the status CHECK is left alone —
-- 'graded' is derived (grade IS NOT NULL), not a new status value, so no
-- constraint is narrowed or widened.
-- =============================================================

ALTER TABLE edu.self_study_targets ADD COLUMN IF NOT EXISTS grade     INTEGER;
ALTER TABLE edu.self_study_targets ADD COLUMN IF NOT EXISTS feedback  JSONB NOT NULL DEFAULT '{}';
ALTER TABLE edu.self_study_targets ADD COLUMN IF NOT EXISTS graded_at TIMESTAMPTZ;
ALTER TABLE edu.self_study_targets ADD COLUMN IF NOT EXISTS graded_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_self_study_target_grade
  ON edu.self_study_targets(assignment_id, grade);
