-- =============================================================
-- 2026-submission-question-files.sql
-- An assignment is answered question by question, and a file (a photo of
-- working, a document, a whiteboard drawing) answers ONE question.
--
-- self_study_files.question_index — the question (0-based) the file
--   answers; NULL for files on activities without questions (the whole
--   submission). Up to 3 files per question (enforced by the API).
-- =============================================================

ALTER TABLE edu.self_study_files ADD COLUMN IF NOT EXISTS question_index INTEGER;
CREATE INDEX IF NOT EXISTS idx_self_study_files_target_question
  ON edu.self_study_files(target_id, question_index);
