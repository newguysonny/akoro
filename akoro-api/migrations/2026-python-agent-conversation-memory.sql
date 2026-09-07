-- =============================================================
-- 2026-python-agent-conversation-memory.sql
-- Durable, learner-controlled conversation context for the additive Python
-- adaptive-agent service. Akoro API remains the database owner; Python uses a
-- short-lived capability through the private gateway and has no DB credential.
-- =============================================================

-- Idempotency fields let a retried Python turn repair a partial write without
-- duplicating either side of a user/assistant exchange. Existing browser chat
-- rows leave these nullable and retain their current behaviour.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS agent_session_id text,
  ADD COLUMN IF NOT EXISTS agent_turn_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_agent_turn_role
  ON public.chat_messages(session_id, agent_session_id, agent_turn_id, role)
  WHERE agent_session_id IS NOT NULL AND agent_turn_id IS NOT NULL;

-- One compact generated summary per conversation. It is deliberately separate
-- from the raw transcript so the prompt can use a small carry-over context.
CREATE TABLE IF NOT EXISTS edu.learner_agent_conversation_summaries (
  chat_session_id uuid PRIMARY KEY REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  summary         text NOT NULL,
  source_message_count integer NOT NULL DEFAULT 0 CHECK (source_message_count >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(summary) BETWEEN 1 AND 4000)
);

CREATE INDEX IF NOT EXISTS idx_learner_agent_conversation_summaries_user
  ON edu.learner_agent_conversation_summaries(user_id, updated_at DESC);

-- Durable notes are bounded, study-only data rather than a second unbounded
-- transcript. Learners can list and forget them through authenticated routes.
CREATE TABLE IF NOT EXISTS edu.learner_agent_memories (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chat_session_id      uuid REFERENCES public.chat_sessions(id) ON DELETE SET NULL,
  agent_session_id     text NOT NULL,
  agent_turn_id        text NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('learning_summary', 'study_preference', 'learner_goal')),
  content              text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 1500),
  subject              text,
  topic                text,
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'forgotten')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_session_id, agent_session_id, agent_turn_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_learner_agent_memories_active
  ON edu.learner_agent_memories(user_id, updated_at DESC)
  WHERE status = 'active';

-- Records a completed/recoverable cross-service turn. The service may repeat a
-- request with the same session+turn id after a timeout; the unique key makes
-- the transcript, summary, and memory write safe to replay.
CREATE TABLE IF NOT EXISTS edu.learner_agent_conversation_turns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chat_session_id   uuid NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  agent_session_id  text NOT NULL,
  agent_turn_id     text NOT NULL,
  status            text NOT NULL DEFAULT 'writing' CHECK (status IN ('writing', 'completed', 'failed')),
  error_code        text,
  user_message_id   uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  agent_message_id  uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  completed_at      timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_session_id, agent_session_id, agent_turn_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_agent_conversation_turns_owner
  ON edu.learner_agent_conversation_turns(user_id, chat_session_id, updated_at DESC);
