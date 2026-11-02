-- =============================================================
-- 2026-agent-action-basis.sql
-- Grand Plan Phase 18, item 6 — asked or inferred, on every agent action.
-- Each side-effecting agent action records its basis: 'explicit' (a person
-- asked for it) or 'inferred' (the agent decided), with the rule that allowed
-- an inferred one (a consent, a proactive kind, a workflow policy, an approved
-- request) in basis_rule. Code: agent-runtime/actionBasis.js.
--   edu.self_tool_events               the self-tooling audit (builds)
--   edu.agent_tool_write_confirmations change cards (self-tooling writes)
--   edu.agent_proposals                proactive ideas and their deliveries
--   edu.verify_real_user_runs          V4 real-account approvals (an admin asked)
-- Rows written before this stay NULL (unknown) — except proposals and
-- real-account runs, whose basis is fixed by what they are. Idempotent.
-- =============================================================
ALTER TABLE edu.self_tool_events
  ADD COLUMN IF NOT EXISTS basis text,
  ADD COLUMN IF NOT EXISTS basis_rule text;

ALTER TABLE edu.agent_tool_write_confirmations
  ADD COLUMN IF NOT EXISTS basis text,
  ADD COLUMN IF NOT EXISTS basis_rule text;

ALTER TABLE edu.agent_proposals
  ADD COLUMN IF NOT EXISTS basis text DEFAULT 'inferred',
  ADD COLUMN IF NOT EXISTS basis_rule text;
UPDATE edu.agent_proposals SET basis = 'inferred' WHERE basis IS NULL;
UPDATE edu.agent_proposals SET basis_rule = 'proactive:' || kind WHERE basis_rule IS NULL;

-- A proposal is always the agent's own idea, allowed by its proactive kind:
-- a writer that leaves the rule out still gets it.
CREATE OR REPLACE FUNCTION edu.agent_proposals_basis_rule() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.basis := COALESCE(NEW.basis, 'inferred');
  IF NEW.basis = 'inferred' AND NEW.basis_rule IS NULL THEN
    NEW.basis_rule := 'proactive:' || NEW.kind;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_agent_proposals_basis_rule ON edu.agent_proposals;
CREATE TRIGGER trg_agent_proposals_basis_rule BEFORE INSERT ON edu.agent_proposals
  FOR EACH ROW EXECUTE FUNCTION edu.agent_proposals_basis_rule();

ALTER TABLE edu.verify_real_user_runs
  ADD COLUMN IF NOT EXISTS basis text DEFAULT 'explicit',
  ADD COLUMN IF NOT EXISTS basis_rule text;
UPDATE edu.verify_real_user_runs SET basis = 'explicit' WHERE basis IS NULL;

-- Only the two values, and an inferred row names its rule.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['self_tool_events', 'agent_tool_write_confirmations', 'agent_proposals', 'verify_real_user_runs'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_basis_check' AND conrelid = ('edu.' || t)::regclass) THEN
      EXECUTE format('ALTER TABLE edu.%I ADD CONSTRAINT %I CHECK (basis IS NULL OR basis IN (''explicit'', ''inferred''))', t, t || '_basis_check');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_basis_rule_check' AND conrelid = ('edu.' || t)::regclass) THEN
      EXECUTE format('ALTER TABLE edu.%I ADD CONSTRAINT %I CHECK (basis IS DISTINCT FROM ''inferred'' OR basis_rule IS NOT NULL)', t, t || '_basis_rule_check');
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
