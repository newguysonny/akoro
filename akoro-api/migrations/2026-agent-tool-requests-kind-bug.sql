-- =============================================================
-- 2026-agent-tool-requests-kind-bug.sql
-- Learners can now report BUGS through the same Agent requests queue
-- (kind='bug'), so they get the same triage, learner notification and
-- agent chat message as tool/component requests. Idempotent.
-- =============================================================
ALTER TABLE edu.agent_tool_requests DROP CONSTRAINT IF EXISTS agent_tool_requests_kind_check;
ALTER TABLE edu.agent_tool_requests ADD CONSTRAINT agent_tool_requests_kind_check
  CHECK (kind IN ('tool', 'capability', 'component', 'bug'));
