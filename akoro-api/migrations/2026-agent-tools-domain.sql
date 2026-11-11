-- =============================================================
-- 2026-agent-tools-domain.sql — explicit domain metadata for learner tools.
--
-- A "domain tool" is one tool per data view with { action } sub-params. Store the
-- domain (the view) and the action set on the row so dedupe / repair / cleanup
-- reason by DOMAIN instead of fuzzy goal text. Backfills existing rows from the
-- `views` array and `params_schema.action.enum` they already carry.
-- Idempotent.
-- =============================================================
ALTER TABLE edu.agent_tools ADD COLUMN IF NOT EXISTS domain text;
ALTER TABLE edu.agent_tools ADD COLUMN IF NOT EXISTS actions jsonb;

UPDATE edu.agent_tools
   SET domain = views->>0
 WHERE domain IS NULL
   AND jsonb_typeof(views) = 'array'
   AND jsonb_array_length(views) > 0;

UPDATE edu.agent_tools
   SET actions = params_schema->'action'->'enum'
 WHERE actions IS NULL
   AND jsonb_typeof(params_schema->'action'->'enum') = 'array';

CREATE INDEX IF NOT EXISTS idx_agent_tools_owner_domain
  ON edu.agent_tools (owner_id, domain) WHERE status = 'active';

NOTIFY pgrst, 'reload schema';
