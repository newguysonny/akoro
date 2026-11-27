-- =============================================================
-- 2026-plugin-runtime.sql — the Plugin Runtime (2026-11-27):
-- declarative UI presentations on built tools, MODE tools
-- (interactive session/protocol tools: a steer, a state document
-- and declared state actions), and the per-learner tool state
-- those modes move.
--
--   agent_tools.presentation  the tool's UI spec (uiCatalogue.js) —
--                             rendered by the learner app in the
--                             tool's tab; also the build card's
--                             live preview payload source.
--   agent_tools.mode          gains 'mode' alongside recipe/spec/code.
--   edu.agent_tool_state      one live state document per learner
--                             + tool, moved only by the tool's
--                             declared actions (modeSpec.js).
-- Idempotent.
-- =============================================================

ALTER TABLE edu.agent_tools ADD COLUMN IF NOT EXISTS presentation jsonb;

-- The mode CHECK predates mode tools: widen it to include 'mode'.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'edu.agent_tools'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%recipe%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE edu.agent_tools DROP CONSTRAINT %I', c);
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_tools_mode_check'
                 AND conrelid = 'edu.agent_tools'::regclass) THEN
    ALTER TABLE edu.agent_tools ADD CONSTRAINT agent_tools_mode_check
      CHECK (mode IN ('recipe', 'spec', 'code', 'mode'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS edu.agent_tool_state (
  tool_id    uuid NOT NULL REFERENCES edu.agent_tools(id) ON DELETE CASCADE,
  owner_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  state      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tool_id, owner_id)
);
