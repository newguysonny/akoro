-- =============================================================
-- 2026-chat-sessions.sql
-- Persistent, per-user chat sessions for the learner "Agent Chat" tab.
-- A session groups an ordered list of messages so a learner can browse
-- and resume past conversations from the drawer (hamburger menu) instead
-- of losing everything on refresh.
--
-- Distinct from chat_history (agent-keyed request/response log): these
-- tables are user-facing, ordered, and titled for the sessions drawer.
-- Idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title           text NOT NULL DEFAULT 'New chat',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
  ON public.chat_sessions(user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('user', 'agent')),
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON public.chat_messages(session_id, created_at);

-- Verify:
-- SELECT s.title, count(m.*) msgs, s.last_message_at
--   FROM public.chat_sessions s
--   LEFT JOIN public.chat_messages m ON m.session_id = s.id
--   GROUP BY s.id ORDER BY s.last_message_at DESC;
