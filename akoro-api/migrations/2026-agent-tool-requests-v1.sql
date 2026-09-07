-- ============================================================================
-- 2026-agent-tool-requests-v1.sql
-- Learner-approved Agent Chat product requests for Akoro admins.
--
-- This table is deliberately a compact product-feedback queue, never a raw chat
-- transcript or an autonomous integration queue. The agent may only create a
-- record after explicit learner approval; an admin independently reviews it.
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.agent_tool_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title                  TEXT NOT NULL CHECK (char_length(title) BETWEEN 6 AND 120),
  description            TEXT NOT NULL CHECK (char_length(description) BETWEEN 20 AND 800),
  category               TEXT NOT NULL CHECK (category IN (
                           'study_support', 'organisation', 'integration', 'accessibility', 'other')),
  request_fingerprint    TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  status                 TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
                           'new', 'under_review', 'planned', 'declined', 'implemented')),
  admin_note             TEXT CHECK (admin_note IS NULL OR char_length(admin_note) <= 1000),
  reviewed_by            UUID REFERENCES public.users(id) ON DELETE SET NULL,
  last_status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (requester_id, request_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_requests_review_queue
  ON edu.agent_tool_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tool_requests_requester_recent
  ON edu.agent_tool_requests (requester_id, created_at DESC);

GRANT USAGE ON SCHEMA edu TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.agent_tool_requests TO service_role;

NOTIFY pgrst, 'reload schema';
