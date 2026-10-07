-- ============================================================================
-- 2026-exam-prep-confidence-loop-v1.sql
-- Learner-owned, bounded diagnostic → teach-back → fresh-retest workflow.
-- Question provenance is explicit: this first version stores generated
-- exam-style practice, not historic past-paper content.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.exam_prep_confidence_policies (
  exam_board       TEXT NOT NULL CHECK (char_length(exam_board) BETWEEN 1 AND 80),
  subject          TEXT NOT NULL DEFAULT '*' CHECK (char_length(subject) BETWEEN 1 AND 180),
  pass_threshold   NUMERIC(5,4) NOT NULL DEFAULT 0.7000 CHECK (pass_threshold >= 0.4 AND pass_threshold <= 1),
  max_attempts     INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
  policy_version   TEXT NOT NULL DEFAULT 'exam-confidence-v1' CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (exam_board, subject)
);

CREATE TABLE IF NOT EXISTS edu.learner_exam_prep_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  topic              TEXT NOT NULL CHECK (char_length(topic) BETWEEN 3 AND 180),
  subject            TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 180),
  exam_board         TEXT NOT NULL CHECK (char_length(exam_board) BETWEEN 1 AND 80),
  question_provenance TEXT NOT NULL DEFAULT 'generated_exam_style' CHECK (question_provenance = 'generated_exam_style'),
  pass_threshold     NUMERIC(5,4) NOT NULL CHECK (pass_threshold >= 0.4 AND pass_threshold <= 1),
  max_attempts       INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 5),
  policy_version     TEXT NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  question_count     INTEGER NOT NULL DEFAULT 5 CHECK (question_count BETWEEN 3 AND 10),
  status             TEXT NOT NULL DEFAULT 'diagnostic_ready' CHECK (status IN (
                       'diagnostic_ready', 'teach_back_required', 'retest_ready', 'passed', 'change_approach')),
  current_attempt     INTEGER NOT NULL DEFAULT 1 CHECK (current_attempt BETWEEN 1 AND 5),
  last_score          NUMERIC(5,4) CHECK (last_score >= 0 AND last_score <= 1),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

ALTER TABLE edu.learner_exam_prep_runs
  ADD COLUMN IF NOT EXISTS question_count INTEGER NOT NULL DEFAULT 5 CHECK (question_count BETWEEN 3 AND 10);

CREATE INDEX IF NOT EXISTS idx_learner_exam_prep_runs_recent
  ON edu.learner_exam_prep_runs (learner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS edu.learner_exam_prep_attempts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID NOT NULL REFERENCES edu.learner_exam_prep_runs(id) ON DELETE CASCADE,
  attempt_number      INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 5),
  kind                TEXT NOT NULL CHECK (kind IN ('diagnostic', 'retest')),
  questions           JSONB NOT NULL CHECK (jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) BETWEEN 3 AND 10),
  answer_key          JSONB NOT NULL CHECK (jsonb_typeof(answer_key) = 'object'),
  submitted_answers   JSONB,
  score               NUMERIC(5,4) CHECK (score >= 0 AND score <= 1),
  submitted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_learner_exam_prep_attempts_run
  ON edu.learner_exam_prep_attempts (run_id, attempt_number DESC);

GRANT USAGE ON SCHEMA edu TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.exam_prep_confidence_policies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.learner_exam_prep_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.learner_exam_prep_attempts TO service_role;

NOTIFY pgrst, 'reload schema';
