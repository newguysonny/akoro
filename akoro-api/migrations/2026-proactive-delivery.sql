-- =============================================================
-- 2026-proactive-delivery.sql — Grand Plan §7.16.3 / D49
-- A planner proposal is posted into the learner's chat as an agent message
-- with reply buttons: the chat the idea came from (used in the last 7 days),
-- else their latest chat, else a new one. These columns record where it went
-- so a decision made in either place (the chat or Suggestions) shows in both.
-- =============================================================

ALTER TABLE edu.agent_proposals ADD COLUMN IF NOT EXISTS source_chat_id  uuid;          -- the chat the noticed signal came from
ALTER TABLE edu.agent_proposals ADD COLUMN IF NOT EXISTS chat_session_id uuid;          -- the chat it was posted into
ALTER TABLE edu.agent_proposals ADD COLUMN IF NOT EXISTS chat_message_id uuid;          -- the agent message carrying it
ALTER TABLE edu.agent_proposals ADD COLUMN IF NOT EXISTS posted_at       timestamptz;
CREATE INDEX IF NOT EXISTS idx_agent_proposals_unposted
  ON edu.agent_proposals(user_id, created_at DESC) WHERE status = 'proposed' AND posted_at IS NULL;

NOTIFY pgrst, 'reload schema';
