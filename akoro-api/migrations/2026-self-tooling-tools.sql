-- =============================================================
-- 2026-self-tooling-tools.sql
-- Tools the learner's agent builds with create_tool (plan §7.10, §10), and
-- one analytics row per create_tool attempt. Learner tools are private to
-- their owner; promotion to everyone (scope 'platform') is phase S4.
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.agent_tools (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid REFERENCES public.users(id) ON DELETE CASCADE,
  scope          text NOT NULL DEFAULT 'learner' CHECK (scope IN ('learner','platform')),
  name           text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{2,47}$'),
  label          text NOT NULL CHECK (length(label) BETWEEN 2 AND 60),
  goal           text NOT NULL CHECK (length(goal) BETWEEN 3 AND 300),
  mode           text NOT NULL CHECK (mode IN ('recipe','spec','code')),
  definition     jsonb NOT NULL,
  params_schema  jsonb NOT NULL DEFAULT '{}'::jsonb,
  capabilities   text[] NOT NULL DEFAULT '{}',
  views          text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','revoked','archived')),
  version        integer NOT NULL DEFAULT 1,
  verification   jsonb,
  usage_count    integer NOT NULL DEFAULT 0,
  fail_streak    integer NOT NULL DEFAULT 0,
  last_used_at   timestamptz,
  promoted_from  uuid REFERENCES edu.agent_tools(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_tools_owner_name_live
  ON edu.agent_tools (COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
  WHERE status IN ('active','disabled');
CREATE INDEX IF NOT EXISTS idx_agent_tools_owner ON edu.agent_tools (owner_id, status, last_used_at DESC);

CREATE TABLE IF NOT EXISTS edu.self_tool_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  goal          text NOT NULL,
  outcome       text NOT NULL CHECK (outcome IN ('created','escalated','rejected','failed','dry')),
  mode          text,
  stages_tried  text[] NOT NULL DEFAULT '{}',
  capabilities  text[] NOT NULL DEFAULT '{}',
  tool_id       uuid,
  reason        text,
  builder_calls integer NOT NULL DEFAULT 0,
  ms            integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_self_tool_events_user ON edu.self_tool_events (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON edu.agent_tools, edu.self_tool_events TO service_role;
NOTIFY pgrst, 'reload schema';
