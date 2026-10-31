-- =============================================================
-- 2026-agent-episodes.sql — the trajectory store for the Akoro Agent Model
-- (training/SPEC.md §3, Grand Plan Phase 17). One row per agent episode:
-- what the model was given, each decision and observation, and a verdict
-- computed by code (agent-contract/episode.js).
--   source 'synthetic'  benchmark and teacher-generated runs (no learner)
--   source 'real'       live traffic — from a learner who opted in
--                       (users.agent_training_consent), or from every user
--                       who hasn't opted out when AGENT_EPISODES=all;
--                       anonymised before
--                       it is written (agent-contract/anonymise.js); never
--                       holds the user id or a way back to the learner.
-- Separate from everything else on purpose: service role only, no RLS reads.
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.agent_episodes (
  id            text PRIMARY KEY,
  source        text NOT NULL CHECK (source IN ('synthetic', 'real')),
  surface       text NOT NULL,
  verdict       text NOT NULL CHECK (verdict IN ('pass', 'fail')),
  failure_class text,
  capabilities  text[] NOT NULL DEFAULT '{}',
  scenario      text,
  model         text,
  episode       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_episodes_source ON edu.agent_episodes (source, verdict, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_episodes_scenario ON edu.agent_episodes (scenario) WHERE scenario IS NOT NULL;
ALTER TABLE edu.agent_episodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON edu.agent_episodes FROM anon, authenticated;

-- The opt-in (SPEC §9): off by default. Set only through the learner's own
-- settings, with a guardian's consent for minors — that setting is built in a
-- later step; until then nothing from real traffic is stored.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS agent_training_consent boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS agent_training_consent_at timestamptz;
-- AGENT_EPISODES=all (decided 2026-10-31): every user's turns are recorded,
-- anonymised, unless they opt out — the opt-out always wins.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS agent_training_opt_out boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
