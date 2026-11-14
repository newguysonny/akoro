-- =============================================================
-- 2026-self-tooling-disabled-actions.sql — per-action on/off for domain tools.
--
-- A domain tool's action set lives in `actions` / params_schema.action.enum.
-- The learner can switch individual actions off (Settings → Agent → My tools
-- → open the domain): off actions are named here, hidden from the model's
-- catalogue (toolDef) and refused at run time (runLearnerTool). Deleting an
-- action removes it from the set entirely, so this list only ever names
-- actions that still exist. Idempotent.
-- =============================================================
ALTER TABLE edu.agent_tools ADD COLUMN IF NOT EXISTS disabled_actions jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
