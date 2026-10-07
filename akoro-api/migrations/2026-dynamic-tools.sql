-- ─────────────────────────────────────────────────────────────────────────────
-- dynamic_tools — config-only agentic tools (no code deploy required)
--
-- Lets a forward-deployed engineer attach a tool to a partner (a teacher account
-- or a whole school) by inserting a row. The task worker loads these at run time
-- alongside the built-in code tools.
--
-- scope:
--   'global'  → every account sees it
--   'user'    → only owner_user_id sees it
--   'school'  → every teacher in school_id sees it
--
-- executor: which built-in interpreter runs the config
--   'llm_prompt'   → fills a prompt template with the tool input, calls the LLM,
--                    stores the text as a task output
--   'notify'       → sends a notification to the student/owner
--   'create_battle'→ creates a 1v1 battle from the tool input
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dynamic_tools (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,                         -- snake_case tool name exposed to the LLM
  description     TEXT NOT NULL,                         -- when-to-use, read by the model
  input_schema    JSONB NOT NULL DEFAULT '{"type":"object","properties":{}}',
  executor        TEXT NOT NULL CHECK (executor IN ('llm_prompt', 'notify', 'create_battle')),
  config          JSONB NOT NULL DEFAULT '{}',           -- executor-specific config (prompt, template, etc.)
  scope           TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global', 'user', 'school')),
  owner_user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  school_id       UUID REFERENCES school_profiles(id) ON DELETE CASCADE,
  intent_keywords TEXT[] NOT NULL DEFAULT '{}',          -- optional, for future conversational routing
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dynamic_tools_owner  ON dynamic_tools(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dynamic_tools_school ON dynamic_tools(school_id)      WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dynamic_tools_scope  ON dynamic_tools(scope, enabled);

-- Example: a per-school "exam tip" tool an FDE added for one school, no deploy.
-- INSERT INTO dynamic_tools (name, description, input_schema, executor, config, scope, school_id, intent_keywords)
-- VALUES (
--   'exam_tip',
--   'Give a concise WAEC exam tip and worked example for a given topic.',
--   '{"type":"object","properties":{"topic":{"type":"string"}},"required":["topic"]}',
--   'llm_prompt',
--   '{"prompt":"Give one WAEC exam tip and a short worked example for: {{topic}}","outputType":"explanation","maxTokens":800}',
--   'school',
--   '<SCHOOL_UUID>',
--   ARRAY['exam tip','waec tip']
-- );
