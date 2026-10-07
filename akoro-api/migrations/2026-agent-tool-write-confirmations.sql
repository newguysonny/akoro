-- =============================================================
-- 2026-agent-tool-write-confirmations.sql
-- Learner-reviewed, one-use authorisation for Python-agent writes.
-- A proposal is not a task/schedule operation. Only the private gateway may
-- consume a confirmed row, and it uses the server-stored validated arguments.
-- =============================================================

CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.agent_tool_write_confirmations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    capability_jti   TEXT NOT NULL,
    session_id       TEXT NOT NULL,
    principal_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    tool_name        TEXT NOT NULL,
    tool_arguments   JSONB NOT NULL,
    arguments_digest TEXT NOT NULL CHECK (arguments_digest ~ '^[a-f0-9]{64}$'),
    preview          JSONB NOT NULL DEFAULT '{}'::jsonb,
    proposal_key     TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'confirmed', 'consumed', 'rejected', 'expired')),
    expires_at       TIMESTAMPTZ NOT NULL,
    confirmed_at     TIMESTAMPTZ,
    rejected_at      TIMESTAMPTZ,
    consumed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (capability_jti, proposal_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_write_confirmations_owner_status
    ON edu.agent_tool_write_confirmations (principal_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tool_write_confirmations_expiry
    ON edu.agent_tool_write_confirmations (status, expires_at);

GRANT ALL ON edu.agent_tool_write_confirmations TO service_role;
