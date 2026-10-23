-- 2026-deferred-jobs.sql — far-future queue jobs wait in Postgres, not Redis (2026-10-23).
--
-- A BullMQ queue holding ANY delayed job makes its worker poll Redis every
-- 10 seconds (its cap on the blocking wait), whatever the worker's drainDelay
-- — a battle's 48-hour idle cleanup, a learner's next review or a recurring
-- task's next run kept workers polling around the clock, ~17k commands a day
-- each on per-command-billed Redis. Jobs due further out than a few minutes
-- now wait here; lib/deferredJobs.js hands each one to its queue shortly
-- before it is due. Recurring jobs keep their cron pattern (repeat) and get
-- their next due time after each release. Idempotent (schema group).

CREATE TABLE IF NOT EXISTS edu.deferred_jobs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue      TEXT NOT NULL,                 -- BullMQ queue name
  job_key    TEXT NOT NULL,                 -- the BullMQ jobId it is released with
  name       TEXT NOT NULL,                 -- the BullMQ job name
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  opts       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- job options minus delay/repeat
  repeat     JSONB,                         -- { pattern, tz } for a recurring job
  due_at     TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_deferred_jobs_key UNIQUE (queue, job_key)
);

CREATE INDEX IF NOT EXISTS idx_deferred_jobs_due ON edu.deferred_jobs(due_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON edu.deferred_jobs TO service_role;
