-- =============================================================
-- 2026-agent-execution-log.sql — Phase 22: the durable execution path.
--
-- One `agent_runs` row per Agent Chat turn, one `agent_run_steps` row per tool
-- call, so the full path (LLM decision → tool call → backend/DB error →
-- retry) survives the turn and can be read back after a failure or crash.
--
-- PRIVACY: stores only redacted, operation-level data — a scrubbed tool input,
-- a status, an error class and a short message. It NEVER holds raw tool
-- arguments, raw results, model reasoning, secrets or answer keys. Service
-- role only: RLS on, no learner/anon reads (same posture as agent_episodes).
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.agent_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid,
  user_id       uuid,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'ok', 'failed', 'incomplete')),
  error_class   text,
  step_count    integer NOT NULL DEFAULT 0,
  model         text
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status_started ON edu.agent_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON edu.agent_runs (session_id, started_at DESC);

CREATE TABLE IF NOT EXISTS edu.agent_run_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        uuid NOT NULL REFERENCES edu.agent_runs(id) ON DELETE CASCADE,
  iteration     integer NOT NULL DEFAULT 0,
  tool          text NOT NULL,
  input_redacted jsonb,
  status        text NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
  error_class   text,
  error_message text,
  duration_ms   integer,
  retries       integer NOT NULL DEFAULT 0,
  request_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run ON edu.agent_run_steps (run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_run_steps_tool ON edu.agent_run_steps (tool, status, created_at DESC);

ALTER TABLE edu.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE edu.agent_run_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON edu.agent_runs FROM anon, authenticated;
REVOKE ALL ON edu.agent_run_steps FROM anon, authenticated;

-- The failure digest (Phase 22, step 5): recurring failures clustered from the
-- execution log, turned into reusable lessons. Service role only; an admin reads
-- it and can turn a lesson into a prompt override (never auto-applied).
CREATE TABLE IF NOT EXISTS edu.agent_failure_digests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  failure_count integer NOT NULL DEFAULT 0,
  clusters      jsonb NOT NULL DEFAULT '[]',
  lessons       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_failure_digests_created ON edu.agent_failure_digests (created_at DESC);
ALTER TABLE edu.agent_failure_digests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON edu.agent_failure_digests FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
