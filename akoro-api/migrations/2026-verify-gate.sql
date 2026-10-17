-- =============================================================
-- 2026-verify-gate.sql
-- The Verification Gate (modules/verify): persisted runs and assertions, so
-- a verdict survives restarts and can be cited ("run <id>, PASS on <sha>").
-- See reference/Self-Tooling & Verification Gate — Grand Plan.md §8, §10.
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.verify_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('scenario','suite','tool')),
  name          text NOT NULL,
  target        text NOT NULL DEFAULT 'production' CHECK (target IN ('production','local','sandbox')),
  actor         text NOT NULL DEFAULT 'coding-agent',
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  real_user     boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','cancelled')),
  verdict       text CHECK (verdict IN ('PASS','FAIL','BLOCKED','ERROR','INCONCLUSIVE')),
  reason        text,
  build_sha     text,
  expected_sha  text,
  cost_usd      numeric NOT NULL DEFAULT 0,
  ms            integer,
  evidence      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_verify_runs_created ON edu.verify_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verify_runs_name ON edu.verify_runs (name, created_at DESC);

CREATE TABLE IF NOT EXISTS edu.verify_assertions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES edu.verify_runs(id) ON DELETE CASCADE,
  scenario    text NOT NULL,
  repeat      integer NOT NULL DEFAULT 1,
  name        text NOT NULL,
  passed      boolean NOT NULL,
  expected    jsonb,
  actual      jsonb,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verify_assertions_run ON edu.verify_assertions (run_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON edu.verify_runs, edu.verify_assertions TO service_role;
NOTIFY pgrst, 'reload schema';
