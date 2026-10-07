-- Add an atomic in-progress state so cancellation can win the race against a
-- delayed worker before it creates the learner's new chat session.

ALTER TABLE edu.scheduled_chat_follow_ups
  DROP CONSTRAINT IF EXISTS scheduled_chat_follow_ups_status_check;

ALTER TABLE edu.scheduled_chat_follow_ups
  ADD CONSTRAINT scheduled_chat_follow_ups_status_check
  CHECK (status IN ('scheduled', 'delivering', 'delivered', 'failed', 'cancelled'));
