-- =============================================================
-- 2026-follow-ups-into-existing-chat.sql
-- A scheduled agent message can now land in an EXISTING chat ("message me
-- here in 10 minutes"), so several follow-ups may share one chat_session_id.
-- The UNIQUE constraint assumed one new chat per follow-up. Idempotent.
-- =============================================================
ALTER TABLE edu.scheduled_chat_follow_ups
  DROP CONSTRAINT IF EXISTS scheduled_chat_follow_ups_chat_session_id_key;

CREATE INDEX IF NOT EXISTS idx_scheduled_chat_follow_ups_session
  ON edu.scheduled_chat_follow_ups (chat_session_id);
