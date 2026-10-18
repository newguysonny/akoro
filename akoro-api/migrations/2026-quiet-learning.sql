-- =============================================================
-- 2026-quiet-learning.sql — Grand Plan §7.16.6 (D47, D50)
-- After a conversation settles, one background pass (platform-paid) writes a
-- real summary and merges the learner's memories. This adds:
--   * two memory kinds: fact_about_me (class, exams, subjects, constraints —
--     never sensitive categories) and open_thread (something left unfinished);
--   * where a memory came from (turn = the in-chat regex, quiet_learning);
--   * the learner's consent, "Learn from my conversations" (on by default
--     with the agent Online, D47);
--   * one row per pass — idempotent on (chat_session_id, watermark) and the
--     weekly budget is counted from it.
-- Memory is guidance, never evidence (D50): nothing here feeds mastery.
-- =============================================================

DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'edu.learner_agent_memories'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE edu.learner_agent_memories DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE edu.learner_agent_memories
  ADD CONSTRAINT learner_agent_memories_kind_check
  CHECK (kind IN ('learning_summary', 'study_preference', 'learner_goal', 'fact_about_me', 'open_thread'));
ALTER TABLE edu.learner_agent_memories ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'turn';

ALTER TABLE edu.learner_agent_autonomy ADD COLUMN IF NOT EXISTS learn_from_chats boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS edu.quiet_learning_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chat_session_id uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  watermark       integer NOT NULL,          -- messages in the chat when the pass ran
  status          text NOT NULL CHECK (status IN ('running', 'done', 'skipped', 'failed')),
  reason          text,
  added           integer NOT NULL DEFAULT 0,
  updated         integer NOT NULL DEFAULT 0,
  forgotten       integer NOT NULL DEFAULT 0,
  tokens          integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  UNIQUE (chat_session_id, watermark)
);
CREATE INDEX IF NOT EXISTS idx_quiet_learning_runs_user ON edu.quiet_learning_runs(user_id, created_at DESC);

GRANT ALL ON edu.quiet_learning_runs TO service_role;
NOTIFY pgrst, 'reload schema';
