-- ============================================================================
-- 2026-adaptive-workflows-v1.sql
-- Durable, public-status workflow records. These rows are not agent
-- scratchpads: no hidden reasoning, raw tool output, or raw learner messages.
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.adaptive_workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workflow_type TEXT NOT NULL CHECK (workflow_type IN ('exam_prep')),
  exam_prep_run_id UUID UNIQUE REFERENCES edu.learner_exam_prep_runs(id) ON DELETE CASCADE,
  topic TEXT NOT NULL CHECK (char_length(topic) BETWEEN 3 AND 180),
  subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 180),
  exam_board TEXT CHECK (char_length(exam_board) <= 80),
  policy_version TEXT NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  state TEXT NOT NULL CHECK (state IN ('researching','planned','diagnostic_ready','teach_back_required','retest_ready','passed','change_approach','cancelled')),
  current_attempt INTEGER NOT NULL DEFAULT 1 CHECK (current_attempt BETWEEN 1 AND 5),
  last_score NUMERIC(5,4) CHECK (last_score >= 0 AND last_score <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_adaptive_workflow_runs_learner_recent
  ON edu.adaptive_workflow_runs (learner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS edu.adaptive_workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES edu.adaptive_workflow_runs(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('researching','planned','diagnostic_ready','teach_back_required','retest_ready','passed','change_approach','cancelled')),
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 3 AND 180),
  attempt_number INTEGER CHECK (attempt_number BETWEEN 1 AND 5),
  score NUMERIC(5,4) CHECK (score >= 0 AND score <= 1),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adaptive_workflow_steps_run
  ON edu.adaptive_workflow_steps (workflow_run_id, occurred_at ASC);

GRANT USAGE ON SCHEMA edu TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.adaptive_workflow_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.adaptive_workflow_steps TO service_role;
NOTIFY pgrst, 'reload schema';
