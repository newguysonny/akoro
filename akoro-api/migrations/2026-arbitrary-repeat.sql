-- =============================================================
-- 2026-arbitrary-repeat.sql
-- Repeating reminders can now repeat at ANY interval the learner names
-- (seconds … years), not just daily/weekdays/hourly. The interval is stored
-- canonically as seconds (every_seconds); repeat='interval' selects it.
-- Idempotent.
-- =============================================================
ALTER TABLE edu.scheduled_chat_follow_ups
  DROP CONSTRAINT IF EXISTS scheduled_chat_follow_ups_repeat_check;
ALTER TABLE edu.scheduled_chat_follow_ups
  ADD CONSTRAINT scheduled_chat_follow_ups_repeat_check
  CHECK (repeat IS NULL OR repeat IN ('daily', 'weekdays', 'hourly', 'interval'));

ALTER TABLE edu.scheduled_chat_follow_ups
  ADD COLUMN IF NOT EXISTS every_seconds integer;
