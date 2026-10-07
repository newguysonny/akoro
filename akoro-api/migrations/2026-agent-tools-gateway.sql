-- Durable replay guard for private Python-agent tool invocations.
-- The gateway, not a browser client, is the only code path that writes here.

CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.agent_tool_invocations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capability_jti  TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    principal_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    tool_name       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed')),
    response        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    UNIQUE (capability_jti, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_invocations_principal_created
    ON edu.agent_tool_invocations (principal_id, created_at DESC);
