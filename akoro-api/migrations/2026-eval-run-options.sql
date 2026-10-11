-- 2026-eval-run-options.sql — per-run options for an eval run, e.g. the test
-- learner the "Learner chat tools" suite runs read-only tools as.
ALTER TABLE edu.eval_runs ADD COLUMN IF NOT EXISTS options JSONB;
