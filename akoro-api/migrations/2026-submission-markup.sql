-- =============================================================
-- 2026-submission-markup.sql
-- The grader marks up the submission PDF, and AI drafts marks.
--
-- self_study_targets.markup — the instructor's marks on the submission
--   PDF: { marks:[{ id, page, type: tick|cross|comment|highlight, x, y,
--   w?, h?, text? }], updatedAt, by }. Positions are fractions of the page
--   (0-1 from the top-left), so they hold at any zoom. On publish the marks
--   are drawn into the PDF ("the marked copy") the learner gets back.
-- self_study_targets.marked_pdf — that marked copy in storage:
--   { key, builtFor, builtAt } (builtFor = graded_at + markup.updatedAt).
-- self_study_targets.ai_grade — the AI's DRAFT marks for the instructor
--   to approve: { status: making|ready|failed, score, questions[],
--   rubric[], feedback, notes[], model, at, error? }. Never published by
--   itself.
-- =============================================================

ALTER TABLE edu.self_study_targets ADD COLUMN IF NOT EXISTS markup     JSONB;
ALTER TABLE edu.self_study_targets ADD COLUMN IF NOT EXISTS marked_pdf JSONB;
ALTER TABLE edu.self_study_targets ADD COLUMN IF NOT EXISTS ai_grade   JSONB;
