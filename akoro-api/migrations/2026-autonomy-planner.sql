-- =============================================================
-- 2026-autonomy-planner.sql — Level 2 (Planner) opt-in
--
-- level 1 = today's due-task check-ins (the existing consent).
-- level 2 = the background planner may REVIEW signals and propose —
--           still nothing executes without the learner's approval.
-- last_cycle_at paces the nightly stagger (one run per ~20h minimum).
--
-- Idempotent; safe to re-run.
-- =============================================================

ALTER TABLE edu.learner_agent_autonomy
  ADD COLUMN IF NOT EXISTS level SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE edu.learner_agent_autonomy
  ADD COLUMN IF NOT EXISTS last_cycle_at TIMESTAMPTZ;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'learner_agent_autonomy_level_check') THEN
    ALTER TABLE edu.learner_agent_autonomy ADD CONSTRAINT learner_agent_autonomy_level_check
      CHECK (level IN (1, 2));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
