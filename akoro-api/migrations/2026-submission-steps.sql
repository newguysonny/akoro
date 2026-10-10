-- =============================================================
-- 2026-submission-steps.sql
-- Assignments are answered — and marked — one question at a time.
--
-- self_study_targets.draft — the learner's answers as they submit them,
--   question by question, before handing the whole assignment in:
--   { answers: { "<index>": value }, savedAt }. Kept on the server, so
--   the work follows the learner across devices. POST /:id/complete
--   hands in these answers (the review step) and the draft stays as the
--   record of what was saved.
-- Per-question marks ride the grade's feedback JSON (no column needed):
--   feedback.questions = [{ index, awarded, max, comment }].
-- =============================================================

ALTER TABLE edu.self_study_targets ADD COLUMN IF NOT EXISTS draft JSONB;
