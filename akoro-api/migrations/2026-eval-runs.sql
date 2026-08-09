-- =============================================================
-- 2026-eval-runs.sql
-- Eval runs and their per-case results.
--
-- The golden-path suites run against a stand-in model, so they prove plumbing
-- — routing, DB writes, failure branches — and say nothing about judgement.
-- Their own README admits it: "What it CANNOT prove: whether a real model picks
-- the right tool or writes good questions."
--
-- These tables hold what a REAL model did, so two questions can be answered
-- that could not be before:
--   · has quality moved?      (pass rate over time, same suite)
--   · can we go cheaper?      (same suite, two models, side by side)
--
-- The second is the point. "50% cheaper without quality loss" is unprovable
-- with nothing to compare, and a run that is not stored cannot be compared to.
--
-- Split like alert_state/alert_events: the run is the thing you list, the
-- results are the detail you open.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.eval_runs (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  suite        TEXT NOT NULL,               -- 'questions' | 'routing'
  model        TEXT NOT NULL,               -- the model UNDER TEST, not the default
  status       TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed | cancelled
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  cases_total  INTEGER NOT NULL DEFAULT 0,
  cases_passed INTEGER NOT NULL DEFAULT 0,
  cases_failed INTEGER NOT NULL DEFAULT 0,
  cost_usd     NUMERIC(12, 8),
  ms           INTEGER,
  error        TEXT,
  created_by   UUID                          -- no FK: the run outlives the admin
);

CREATE TABLE IF NOT EXISTS edu.eval_results (
  id         BIGSERIAL PRIMARY KEY,
  run_id     BIGINT NOT NULL REFERENCES edu.eval_runs(id) ON DELETE CASCADE,
  case_key   TEXT NOT NULL,
  name       TEXT NOT NULL,
  passed     BOOLEAN NOT NULL,
  expected   TEXT,
  actual     TEXT,
  detail     TEXT,
  ms         INTEGER,
  cost_usd   NUMERIC(12, 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The bar this run was judged against, and the verdict.
--
-- Stored ON THE RUN rather than read from the suite at display time, because
-- the bar moves. A run that passed at 0.8 must keep reading as a pass after
-- someone raises the suite to 0.9, or the history rewrites itself every time
-- the standard changes and nobody can tell a real regression from a stricter
-- rule. `met_threshold` is the release gate: cases_passed/cases_total is the
-- measurement, this is the decision.
ALTER TABLE edu.eval_runs ADD COLUMN IF NOT EXISTS threshold     NUMERIC(4, 3);
ALTER TABLE edu.eval_runs ADD COLUMN IF NOT EXISTS met_threshold BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_eval_runs_suite_time ON edu.eval_runs (suite, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_runs_active     ON edu.eval_runs (status) WHERE status IN ('queued', 'running');
-- Failures first is how the results are always read, so index for it.
CREATE INDEX IF NOT EXISTS idx_eval_results_run     ON edu.eval_results (run_id, passed, id);

COMMENT ON TABLE edu.eval_runs IS
  'One row per eval run against a REAL model. The golden-path suites use a stand-in and prove plumbing only.';
COMMENT ON COLUMN edu.eval_runs.model IS
  'The model under test — the point is comparing tiers, so this is chosen per run, not read from OPENAI_MODEL.';

-- Verify:
--   SELECT suite, model, status, cases_passed || '/' || cases_total AS score,
--          round(cost_usd::numeric, 5) AS usd, created_at
--   FROM edu.eval_runs ORDER BY created_at DESC LIMIT 10;
