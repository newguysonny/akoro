-- =============================================================
-- 2026-agent-suggestions.sql
-- Agent suggestions — the agent's proactive ideas, one row each, shown in
-- the AI chat's Tasks tab under the new "Suggestions" pill (To do / Done /
-- Suggestions). A suggestion is the agent noticing a way to help: a task
-- idea, a goal worth aiming at, or a conversation worth starting. It is
-- ONLY advice until the learner acts — accepting creates the real task row
-- (task_id), dismissing just closes the idea. Nothing is ever deleted, so
-- accepted suggestions keep their provenance.
--
-- kind        — task | goal | conversation: what flavour of help is offered.
-- rationale   — why the agent thinks this helps the learner right now.
-- source      — chat | proactive: a live conversation or the agent's own nudge.
-- session_id  — the chat session that produced it (when born in a chat).
-- status      — open → accepted (task_id set) or dismissed.
-- =============================================================

CREATE TABLE IF NOT EXISTS agent_suggestions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id    UUID,                    -- the learner's agent, when it has one
  kind        TEXT NOT NULL DEFAULT 'task',
  title       TEXT NOT NULL,
  rationale   TEXT,
  source      TEXT NOT NULL DEFAULT 'chat',
  session_id  UUID,
  status      TEXT NOT NULL DEFAULT 'open',
  task_id     UUID,                    -- the task created on accept
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_suggestions_user ON agent_suggestions(user_id, status);

GRANT ALL ON agent_suggestions TO service_role;
NOTIFY pgrst, 'reload schema';
