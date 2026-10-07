-- =============================================================
-- 2026-draft-routines.sql
-- Draft routines — recurring, human-approved activity preparation.
-- "Every Friday, prep a multiplication drill battle" becomes a routine row.
-- The scheduler only ever PREPARES a draft at the scheduled time (the same
-- private draft flow as chat: nothing reaches learners); the instructor
-- still previews and assigns each occurrence. Preparation is automation;
-- assignment stays human.
--
-- brief        — the prepare_activity input template (type, subject, topic,
--                audience, …) replayed on every run.
-- schedule     — 'weekly' today; day_of_week (0=Sun) + hour set the slot (UTC).
-- status       — active | paused. Deleting is a real delete (no history need).
-- last_run_at  — doubles as the scheduler's claim: it is stamped BEFORE the
--                prepare runs, so two API instances can never double-prepare.
-- =============================================================

CREATE TABLE IF NOT EXISTS draft_routines (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  brief         JSONB NOT NULL DEFAULT '{}',
  schedule      TEXT NOT NULL DEFAULT 'weekly',
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  hour          SMALLINT NOT NULL DEFAULT 7 CHECK (hour BETWEEN 0 AND 23),
  status        TEXT NOT NULL DEFAULT 'active',
  last_run_at   TIMESTAMPTZ,
  last_draft_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_draft_routines_due ON draft_routines(status, day_of_week);

GRANT ALL ON draft_routines TO service_role;
NOTIFY pgrst, 'reload schema';
