-- =============================================================
-- 2026-agent-outreach.sql — Phase 21 part 2: agents START conversations on
-- their own (a struggle opens, a Study Prep topic starts), and ask their
-- learner first when it needs permission. Idempotent.
--   agent_messages.origin   'learner' (the learner asked in chat) | 'agent' (the agent reached out)
--   agent_messages.trigger  what made the agent reach out (struggle, topic_start, …)
--   agent_messages.purpose  study_question | friend_request | battle_invite | share_data
--   agent_proposals kind 'agent_outreach': "Shall I ask Kemi's agent …?" (Allow / Reject / Later)
-- =============================================================
ALTER TABLE edu.agent_messages ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'learner';
ALTER TABLE edu.agent_messages ADD COLUMN IF NOT EXISTS trigger TEXT;
ALTER TABLE edu.agent_messages ADD COLUMN IF NOT EXISTS purpose TEXT;
DO $c$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_messages_origin_check') THEN
    ALTER TABLE edu.agent_messages ADD CONSTRAINT agent_messages_origin_check CHECK (origin IN ('learner', 'agent'));
  END IF;
END $c$;
CREATE INDEX IF NOT EXISTS idx_agent_messages_outreach ON edu.agent_messages (from_user, created_at DESC) WHERE origin = 'agent';

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
  'agent_friend','agent_reply','agent_outreach'));

NOTIFY pgrst, 'reload schema';
