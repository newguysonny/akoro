-- =============================================================
-- 2026-migration-log.sql
-- Durable record of every `npm run db:deploy` run, so you can confirm from
-- the database (not just ephemeral deploy logs) that migrations applied.
-- Written by scripts/apply-migrations.mjs after each run. Idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.migration_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_group   text        NOT NULL,          -- 'schema' | 'demo' | 'schema,demo'
  applied     int         NOT NULL DEFAULT 0,
  failed      int         NOT NULL DEFAULT 0,
  files       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  git_sha     text,
  ran_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_migration_log_ran_at ON edu.migration_log (ran_at DESC);

GRANT ALL ON edu.migration_log TO service_role;

NOTIFY pgrst, 'reload schema';
