CREATE SCHEMA IF NOT EXISTS edu;

-- Learner-controlled autonomy for due tasks. This is separate from generic
-- user settings because the worker needs a narrowly scoped, durable authority
-- record that it can re-check immediately before sending an Agent Chat.

CREATE TABLE IF NOT EXISTS edu.learner_agent_autonomy (
  user_id    UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.learner_autonomy_task_reviews (
  id              UUID PRIMARY KEY,
  task_id         UUID NOT NULL UNIQUE REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  due_at          TIMESTAMPTZ NOT NULL,
  chat_session_id UUID NOT NULL UNIQUE,
  chat_message_id UUID NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled', 'delivering', 'delivered', 'paused', 'failed', 'cancelled')),
  revision        INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  delivered_at    TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learner_autonomy_reviews_due
  ON edu.learner_autonomy_task_reviews (status, due_at)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_learner_autonomy_reviews_user
  ON edu.learner_autonomy_task_reviews (user_id, status);
