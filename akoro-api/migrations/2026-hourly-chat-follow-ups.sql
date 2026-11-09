-- =============================================================
-- 2026-hourly-chat-follow-ups.sql
-- Repeating Agent Chat check-ins can now be HOURLY as well as daily/weekdays.
-- Widens the repeat CHECK added in 2026-repeating-chat-follow-ups.sql. Idempotent.
-- =============================================================
ALTER TABLE edu.scheduled_chat_follow_ups
  DROP CONSTRAINT IF EXISTS scheduled_chat_follow_ups_repeat_check;
ALTER TABLE edu.scheduled_chat_follow_ups
  ADD CONSTRAINT scheduled_chat_follow_ups_repeat_check
  CHECK (repeat IS NULL OR repeat IN ('daily', 'weekdays', 'hourly'));
