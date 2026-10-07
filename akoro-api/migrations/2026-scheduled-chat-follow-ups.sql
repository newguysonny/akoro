-- Durable, learner-owned future Agent Chat messages.
-- Chat ids are allocated at schedule time so a retried worker write is exactly
-- idempotent without depending on an in-memory delivery flag.

CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.scheduled_chat_follow_ups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    chat_session_id UUID NOT NULL UNIQUE,
    chat_message_id UUID NOT NULL UNIQUE,
    title           TEXT NOT NULL DEFAULT 'Scheduled check-in',
    message         TEXT NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'Africa/Lagos',
    scheduled_at    TIMESTAMPTZ NOT NULL,
    status          TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'delivered', 'failed', 'cancelled')),
    last_error      TEXT,
    delivered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (char_length(title) BETWEEN 1 AND 80),
    CHECK (char_length(message) BETWEEN 1 AND 800)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_chat_follow_ups_due
    ON edu.scheduled_chat_follow_ups (scheduled_at)
    WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_scheduled_chat_follow_ups_user
    ON edu.scheduled_chat_follow_ups (user_id, scheduled_at DESC);
