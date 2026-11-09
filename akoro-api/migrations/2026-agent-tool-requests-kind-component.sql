-- =============================================================
-- 2026-agent-tool-requests-kind-component.sql
-- Extends the Agent requests queue so a learner can ask for a missing LEARNING
-- COMPONENT (a study technique / reusable learning building-block the Creator
-- Agent would compose), not just a tool or integration. 'capability' remains
-- reserved for the self-tooling escalation flow. Idempotent.
-- =============================================================
ALTER TABLE edu.agent_tool_requests DROP CONSTRAINT IF EXISTS agent_tool_requests_kind_check;
ALTER TABLE edu.agent_tool_requests ADD CONSTRAINT agent_tool_requests_kind_check
  CHECK (kind IN ('tool', 'capability', 'component'));
