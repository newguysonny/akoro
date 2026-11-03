-- =============================================================
-- 2026-agent-prompt-overrides.sql — Grand Plan Phase 18 item 7: admin-
-- editable prompt parts with "Default updated".
--
-- The defaults stay the files in akoro-api/akoro-agent/ (the D4 single
-- source); a row here replaces ONE file's text at load time
-- (agent-context/overrides.js). Each override records the default it was
-- based on (hash + text): when a deploy changes that default the part reads
-- "Default updated" and the admin keeps their text or takes the new one.
-- Code-enforced rules (gates, policies, verdicts, tool checks) are code and
-- never live here. Every change is kept in the history table.
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.agent_prompt_overrides (
  file        text PRIMARY KEY,
  text        text NOT NULL,
  base_hash   text NOT NULL,
  base_text   text NOT NULL,
  note        text,
  updated_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE edu.agent_prompt_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON edu.agent_prompt_overrides FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.agent_prompt_overrides TO service_role;

CREATE TABLE IF NOT EXISTS edu.agent_prompt_override_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file        text NOT NULL,
  action      text NOT NULL CHECK (action IN ('edit', 'reset', 'keep_mine', 'use_new_default')),
  text        text,
  base_hash   text,
  note        text,
  actor_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_prompt_override_history_file
  ON edu.agent_prompt_override_history (file, created_at DESC);
ALTER TABLE edu.agent_prompt_override_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON edu.agent_prompt_override_history FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.agent_prompt_override_history TO service_role;

NOTIFY pgrst, 'reload schema';
