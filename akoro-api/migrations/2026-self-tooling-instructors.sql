-- =============================================================
-- 2026-self-tooling-instructors.sql
-- Phase S7: instructors' agents build tools too. A tool is for ONE audience —
-- a learner's tools read learner views, an instructor's read instructor views
-- (their own classes and activities); platform tools are promoted per
-- audience. Idempotent.
-- =============================================================
ALTER TABLE edu.agent_tools ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'learner';
DO $$ BEGIN
  ALTER TABLE edu.agent_tools DROP CONSTRAINT IF EXISTS agent_tools_audience_check;
  ALTER TABLE edu.agent_tools ADD CONSTRAINT agent_tools_audience_check CHECK (audience IN ('learner','instructor'));
END $$;
CREATE INDEX IF NOT EXISTS idx_agent_tools_platform_audience ON edu.agent_tools (scope, audience, status) WHERE scope = 'platform';
NOTIFY pgrst, 'reload schema';
