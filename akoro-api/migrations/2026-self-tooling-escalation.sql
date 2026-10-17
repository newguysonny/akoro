-- =============================================================
-- 2026-self-tooling-escalation.sql
-- Phase S3 (plan §7.8, §7.11): create_tool escalates a goal that needs a
-- LOCKED capability into the existing Agent requests queue (kind
-- 'capability', no fork), with a resume ticket. An admin approval grants the
-- capability for everyone and resumes every waiting request in its chat.
-- Idempotent.
-- =============================================================
ALTER TABLE edu.agent_tool_requests
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'tool',
  ADD COLUMN IF NOT EXISTS requested_capability text,
  ADD COLUMN IF NOT EXISTS goal text,
  ADD COLUMN IF NOT EXISTS proposed_tool jsonb,
  ADD COLUMN IF NOT EXISTS conversation_id uuid,
  ADD COLUMN IF NOT EXISTS resume_status text,
  ADD COLUMN IF NOT EXISTS resume_result jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

DO $$ BEGIN
  ALTER TABLE edu.agent_tool_requests DROP CONSTRAINT IF EXISTS agent_tool_requests_kind_check;
  ALTER TABLE edu.agent_tool_requests ADD CONSTRAINT agent_tool_requests_kind_check CHECK (kind IN ('tool','capability'));
  ALTER TABLE edu.agent_tool_requests DROP CONSTRAINT IF EXISTS agent_tool_requests_resume_status_check;
  ALTER TABLE edu.agent_tool_requests ADD CONSTRAINT agent_tool_requests_resume_status_check
    CHECK (resume_status IS NULL OR resume_status IN ('waiting','resuming','resumed','failed','expired','cancelled'));
  -- statuses gain 'approved' (grant made, resume pending or done) and 'expired'
  ALTER TABLE edu.agent_tool_requests DROP CONSTRAINT IF EXISTS agent_tool_requests_status_check;
  ALTER TABLE edu.agent_tool_requests ADD CONSTRAINT agent_tool_requests_status_check
    CHECK (status IN ('new','under_review','planned','approved','declined','implemented','expired'));
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_tool_requests_capability_open
  ON edu.agent_tool_requests (requested_capability, status) WHERE kind = 'capability';

ALTER TABLE edu.self_tool_events ADD COLUMN IF NOT EXISTS request_id uuid;

NOTIFY pgrst, 'reload schema';
