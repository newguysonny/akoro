-- =============================================================
-- 2026-strategy-outcomes.sql — Phase 4a slice 3 (§7.7, §7.7.1, D37, D40).
-- How a Strategy Library strategy turned out for a learner, written by
-- recordStrategyOutcome (adaptive-learning/strategies/outcomes.js). The
-- library version and the strategy's own version are stored with every row,
-- so old outcomes stay readable after the library changes. Breakthroughs read
-- it for what_worked_strategy; the anonymous pattern (D36) will rank
-- strategies from it. Idempotent per learner + session + turn + strategy.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.learning_strategy_outcomes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  concept_id        UUID REFERENCES edu.concept_catalog(id) ON DELETE SET NULL,
  subject           TEXT,
  topic_label       TEXT,
  strategy_id       TEXT NOT NULL,
  strategy_version  INT NOT NULL,
  library_version   INT NOT NULL,
  workflow          TEXT NOT NULL,
  outcome           TEXT NOT NULL CHECK (outcome IN ('worked', 'partial', 'did_not_work', 'abandoned')),
  struggle_type     TEXT,
  score_before      NUMERIC,
  score_after       NUMERIC,
  session_ref       TEXT NOT NULL,
  turn_ref          TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'backfill')),
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (learner_id, session_ref, turn_ref, strategy_id)
);
CREATE INDEX IF NOT EXISTS idx_strategy_outcomes_session ON edu.learning_strategy_outcomes (learner_id, session_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_outcomes_concept ON edu.learning_strategy_outcomes (learner_id, concept_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_outcomes_pattern ON edu.learning_strategy_outcomes (strategy_id, struggle_type, outcome);
GRANT ALL ON edu.learning_strategy_outcomes TO service_role;

NOTIFY pgrst, 'reload schema';
