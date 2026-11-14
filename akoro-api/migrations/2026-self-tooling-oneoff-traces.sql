-- =============================================================
-- 2026-self-tooling-oneoff-traces.sql — one-off computation traces.
--
-- Option 2 (answer-only): a pure computed read is answered from its verified
-- dry run and NOT saved. The run still leaves a trace in self_tool_events
-- with outcome 'answered' and the verified definition stashed in `detail`,
-- so an explicit "save that" — or the daily repeated-computation sweep that
-- turns repeats into tool suggestions — can save that exact tool later
-- without rebuilding it. Idempotent.
-- =============================================================
ALTER TABLE edu.self_tool_events ADD COLUMN IF NOT EXISTS detail jsonb;

ALTER TABLE edu.self_tool_events DROP CONSTRAINT IF EXISTS self_tool_events_outcome_check;
ALTER TABLE edu.self_tool_events ADD CONSTRAINT self_tool_events_outcome_check
  CHECK (outcome IN ('created','escalated','rejected','failed','dry','answered'));

NOTIFY pgrst, 'reload schema';
