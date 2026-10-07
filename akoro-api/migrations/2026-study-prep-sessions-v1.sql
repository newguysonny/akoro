-- ═══════════════════════════════════════════════════════════════════════════
-- Study-Prep sessions v1 (Master Plan §4.1)
--   study_prep_sessions   durable study session (persists across chats)
--   study_prep_topics     ordered topics within a session (≤ 12, harness-enforced)
--   study_prep_events     append-only agent activity log (union schema S4+S5)
--   adaptive_workflow_runs.study_prep_session_id  → workflow list grouping
--   learner_exam_prep_runs.study_prep_topic_id    → attempts roll up to topics
-- All writes go through the harness (single-writer, conditional updates).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS edu.study_prep_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  goal                 TEXT NOT NULL CHECK (char_length(goal) BETWEEN 3 AND 300),
  subject              TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 180),
  class_level          TEXT NOT NULL DEFAULT 'JSS1' CHECK (char_length(class_level) BETWEEN 1 AND 40),
  entry_mode           TEXT NOT NULL DEFAULT 'syllabus' CHECK (entry_mode IN ('syllabus', 'course', 'material')),
  exam_board           TEXT NOT NULL DEFAULT 'WAEC' CHECK (char_length(exam_board) BETWEEN 1 AND 80),
  status               TEXT NOT NULL DEFAULT 'planning'
                       CHECK (status IN ('planning', 'awaiting_confirmation', 'topic_active',
                                         'replanning', 'paused', 'completed', 'abandoned', 'cancelled')),
  paused_reason        TEXT CHECK (paused_reason IS NULL OR paused_reason IN
                       ('agent_loop_cap', 'insufficient_balance', 'learner_requested')),
  plan                 JSONB,          -- the agent-proposed ordered topic plan (label + id)
  estimate             JSONB,          -- plan-card cost estimate snapshot at proposal time
  strategy_policy_version TEXT NOT NULL DEFAULT 'study-prep-strategies-v1',
  policy_version       TEXT NOT NULL DEFAULT 'study-prep-v1' CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  tool_calls_used      INTEGER NOT NULL DEFAULT 0 CHECK (tool_calls_used >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_study_prep_sessions_recent
  ON edu.study_prep_sessions (learner_id, updated_at DESC);

-- One active (non-terminal) session per learner at a time: the harness checks
-- this too; the partial index makes the guarantee airtight under concurrency.
CREATE UNIQUE INDEX IF NOT EXISTS idx_study_prep_sessions_one_active
  ON edu.study_prep_sessions (learner_id)
  WHERE status IN ('planning', 'awaiting_confirmation', 'topic_active', 'replanning', 'paused');

CREATE TABLE IF NOT EXISTS edu.study_prep_topics (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID NOT NULL REFERENCES edu.study_prep_sessions(id) ON DELETE CASCADE,
  syllabus_topic_id    TEXT NOT NULL CHECK (char_length(syllabus_topic_id) BETWEEN 1 AND 120),
  position             INTEGER NOT NULL CHECK (position BETWEEN 1 AND 12),
  label                TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 180),
  status               TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'active', 'understood', 'flagged_gap', 'capped_out', 'deferred')),
  attempts_used        INTEGER NOT NULL DEFAULT 0 CHECK (attempts_used >= 0),
  deferred_retry_used  BOOLEAN NOT NULL DEFAULT false,
  flagged_reason       TEXT CHECK (flagged_reason IS NULL OR char_length(flagged_reason) <= 240),
  exam_prep_run_id     UUID,
  learner_confirmed_ready BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, syllabus_topic_id),
  UNIQUE (session_id, position)
);

CREATE INDEX IF NOT EXISTS idx_study_prep_topics_session
  ON edu.study_prep_topics (session_id, position);

-- Append-only agent activity log. The union of the two v2.1 schemas:
-- S5's origin/agent_intent/narrative/policy_version/event set plus S4's
-- sequence/thought_type/duration_ms. facts are bounded — never raw chat,
-- never answer keys. narrative is a CACHE of deliberate(); facts are truth.
CREATE TABLE IF NOT EXISTS edu.study_prep_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           UUID NOT NULL REFERENCES edu.study_prep_sessions(id) ON DELETE CASCADE,
  topic_id             UUID REFERENCES edu.study_prep_topics(id) ON DELETE SET NULL,
  sequence             INTEGER NOT NULL,
  iteration            INTEGER,
  event_type           TEXT NOT NULL CHECK (event_type IN
                       ('agent_tool_call', 'agent_action', 'harness_decision',
                        'observation', 'human_gate', 'engine_result')),
  tool                 TEXT CHECK (tool IS NULL OR char_length(tool) <= 80),
  action               TEXT CHECK (action IS NULL OR char_length(action) <= 80),
  agent_intent         TEXT CHECK (agent_intent IS NULL OR char_length(agent_intent) <= 240),
  origin               TEXT NOT NULL CHECK (origin IN ('agent_stated_intent', 'harness', 'engine')),
  decision_node        TEXT CHECK (decision_node IS NULL OR char_length(decision_node) <= 80),
  narrative            TEXT CHECK (narrative IS NULL OR char_length(narrative) <= 500),
  facts                JSONB,
  thought_type         TEXT CHECK (thought_type IS NULL OR thought_type IN
                       ('research', 'draft', 'verification', 'action', 'reflection', 'synthesis')),
  duration_ms          INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  policy_version       TEXT NOT NULL DEFAULT 'study-prep-v1',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_study_prep_events_session
  ON edu.study_prep_events (session_id, sequence);

-- Link the topic workflow projection to its session (workflow list grouping,
-- Master Plan §4.8.3): one list entry per session, topics nested.
ALTER TABLE edu.adaptive_workflow_runs
  ADD COLUMN IF NOT EXISTS study_prep_session_id UUID REFERENCES edu.study_prep_sessions(id) ON DELETE SET NULL;

-- Attempts roll up to a session topic when driven by the harness.
ALTER TABLE edu.learner_exam_prep_runs
  ADD COLUMN IF NOT EXISTS study_prep_topic_id UUID REFERENCES edu.study_prep_topics(id) ON DELETE SET NULL;

GRANT USAGE ON SCHEMA edu TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.study_prep_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.study_prep_topics TO service_role;
GRANT SELECT, INSERT ON edu.study_prep_events TO service_role;

NOTIFY pgrst, 'reload schema';
