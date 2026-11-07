-- =============================================================
-- 2026-agent-conversations.sql — Phase 21: agents talk on their own.
--   agent_messages: kinds 'chat' and 'friend_request'; status 'awaiting_learner';
--     processed_at (the recipient's agent has handled it), auto_replied (it
--     answered on its own), proposal_id (the card that asked its learner).
--   agent_network_settings.auto_reply: 'off' | 'study' (default) | 'study_chat'.
--   agent_friends: two learners whose agents are friends (one row per pair).
--   agent_proposals: kinds 'agent_friend', 'agent_reply'.
-- Idempotent.
-- =============================================================
DO $m$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'edu.agent_messages'::regclass AND contype = 'c'
           AND (pg_get_constraintdef(oid) ILIKE '%kind%' OR pg_get_constraintdef(oid) ILIKE '%status%') LOOP
    EXECUTE format('ALTER TABLE edu.agent_messages DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $m$;
ALTER TABLE edu.agent_messages ADD CONSTRAINT agent_messages_kind_check
  CHECK (kind IN ('consult', 'suggestion', 'reply', 'buddy_checkin', 'invite', 'chat', 'friend_request'));
ALTER TABLE edu.agent_messages ADD CONSTRAINT agent_messages_status_check
  CHECK (status IN ('pending', 'answered', 'delivered', 'read', 'declined', 'awaiting_learner'));
ALTER TABLE edu.agent_messages ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE edu.agent_messages ADD COLUMN IF NOT EXISTS auto_replied BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE edu.agent_messages ADD COLUMN IF NOT EXISTS proposal_id UUID;
-- Messages already in inboxes are history, not new work for the processor.
UPDATE edu.agent_messages SET processed_at = COALESCE(read_at, answered_at, created_at) WHERE processed_at IS NULL AND created_at < now() - interval '1 hour';
CREATE INDEX IF NOT EXISTS idx_agent_messages_unprocessed ON edu.agent_messages (to_user, created_at) WHERE processed_at IS NULL;

ALTER TABLE edu.agent_network_settings ADD COLUMN IF NOT EXISTS auto_reply TEXT NOT NULL DEFAULT 'study';
DO $s$ BEGIN
  ALTER TABLE edu.agent_network_settings ADD CONSTRAINT agent_network_settings_auto_reply_check CHECK (auto_reply IN ('off', 'study', 'study_chat'));
EXCEPTION WHEN duplicate_object THEN NULL; END $s$;

CREATE TABLE IF NOT EXISTS edu.agent_friends (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,   -- the smaller id of the pair
  user_b       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ,
  CHECK (user_a < user_b),
  UNIQUE (user_a, user_b)
);
CREATE INDEX IF NOT EXISTS idx_agent_friends_b ON edu.agent_friends (user_b);

DO $kinds$ DECLARE r record; BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid = 'edu.agent_proposals'::regclass AND contype = 'c'
           AND pg_get_constraintdef(oid) ILIKE '%kind%' LOOP
    EXECUTE format('ALTER TABLE edu.agent_proposals DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $kinds$;
ALTER TABLE edu.agent_proposals ADD CONSTRAINT agent_proposals_kind_check CHECK (kind IN (
  'task','session','goal','practice','battle','plan_digest',
  'quiz_from_records','teach_weak_topic','study_plan','revision_battle','follow_up_question','fix_it',
  'goal_nudge','revise_low_scores','chase_missing','next_activity',
  'agent_friend','agent_reply'));
