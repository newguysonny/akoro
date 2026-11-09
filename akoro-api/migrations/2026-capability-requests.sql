-- =============================================================
-- 2026-capability-requests.sql
-- Structured intake for missing platform capabilities. When an agent (learner
-- protégé or teacher task agent) hits something the platform cannot express —
-- a missing tool executor or learning component — the failure path offers to
-- file a request here instead of ending as a silent dead end. Engineering
-- triages this queue to decide what to build. Idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.capability_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  user_role          text,                       -- requester's role at submit time
  agent_id           uuid REFERENCES public.user_agents(id) ON DELETE SET NULL,
  source             text NOT NULL DEFAULT 'other'
                       CHECK (source IN ('executor', 'component', 'other')),
  intent             text NOT NULL,              -- one line: what the user wanted
  missing_capability text NOT NULL,              -- what the platform lacks, specifically
  closest_match      text,                       -- nearest existing executors/components
  description        text,                       -- fuller learner prompt / context
  status             text NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new', 'triaged', 'planned', 'shipped', 'declined')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capability_requests_status
  ON public.capability_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capability_requests_user
  ON public.capability_requests(user_id);
