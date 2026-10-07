-- =============================================================
-- 2026-python-agent-conversation-scratchpad.sql
-- Per-conversation structured working checklist for the additive Python agent.
-- This intentionally stores no hidden chain-of-thought: only bounded goal,
-- completed work, next steps, open questions, and result-free tool status.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.learner_agent_conversation_scratchpads (
  chat_session_id uuid PRIMARY KEY REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  goal            text NOT NULL CHECK (char_length(goal) BETWEEN 1 AND 500),
  completed       jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_steps      jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_questions  jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_state      jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (CASE WHEN jsonb_typeof(completed) = 'array' THEN jsonb_array_length(completed) <= 6 ELSE false END),
  CHECK (CASE WHEN jsonb_typeof(next_steps) = 'array' THEN jsonb_array_length(next_steps) <= 6 ELSE false END),
  CHECK (CASE WHEN jsonb_typeof(open_questions) = 'array' THEN jsonb_array_length(open_questions) <= 6 ELSE false END),
  CHECK (CASE WHEN jsonb_typeof(tool_state) = 'array' THEN jsonb_array_length(tool_state) <= 4 ELSE false END)
);

CREATE INDEX IF NOT EXISTS idx_learner_agent_conversation_scratchpads_user
  ON edu.learner_agent_conversation_scratchpads(user_id, updated_at DESC);
