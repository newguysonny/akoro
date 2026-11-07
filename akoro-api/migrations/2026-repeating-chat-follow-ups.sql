-- =============================================================
-- 2026-repeating-chat-follow-ups.sql
-- Repeating agent check-ins ("remind me every day at 4:30pm"). A series is a
-- chain: delivering one schedules the next (same chat, same clock time), until
-- repeat_until. Cancelling the pending one ends the series. run_tool: one of
-- the learner's own read tools, run fresh at each send. Idempotent.
-- =============================================================
ALTER TABLE edu.scheduled_chat_follow_ups
  ADD COLUMN IF NOT EXISTS repeat TEXT,
  ADD COLUMN IF NOT EXISTS repeat_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS run_tool TEXT,
  ADD COLUMN IF NOT EXISTS series_id UUID;

DO $$ BEGIN
  ALTER TABLE edu.scheduled_chat_follow_ups
    ADD CONSTRAINT scheduled_chat_follow_ups_repeat_check CHECK (repeat IS NULL OR repeat IN ('daily', 'weekdays'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_scheduled_chat_follow_ups_series
  ON edu.scheduled_chat_follow_ups (series_id) WHERE series_id IS NOT NULL;
