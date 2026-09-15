-- =============================================================
-- 2026-agent-proposals.sql — the Full Autonomy proposal inbox
--
-- The background cycle (and later, event triggers) PROPOSE; only the
-- learner's approval executes anything — through the exact tools the
-- chat uses (create_task / schedule_chat_follow_up / goals insert).
-- docs/learner-full-autonomy-plan.md §4-§7.
--
-- status: proposed → approved → executed (or failed)
--               └→ dismissed / expired (never executed)
-- payload is EXACTLY the tool's input shape so approval is a 1:1 replay.
--
-- autonomy_runs is the transparency ledger: one row per nightly cycle
-- (trigger, proposal count, tokens) — the "what was it doing?" answer.
--
-- Idempotent; safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.agent_proposals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('task','session','goal','practice','battle','plan_digest')),
  title        TEXT NOT NULL,
  rationale    TEXT,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'proposed'
               CHECK (status IN ('proposed','approved','dismissed','expired','executed','failed')),
  executed_ref UUID,
  source       TEXT NOT NULL DEFAULT 'cycle' CHECK (source IN ('cycle','event','chat')),
  decision_note TEXT,
  run_id       UUID,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_edu_agent_proposals_user
  ON edu.agent_proposals(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS edu.autonomy_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  trigger           TEXT NOT NULL DEFAULT 'nightly',
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  proposals_created SMALLINT NOT NULL DEFAULT 0,
  tokens_used       INT NOT NULL DEFAULT 0,
  summary           TEXT
);

CREATE INDEX IF NOT EXISTS idx_edu_autonomy_runs_user
  ON edu.autonomy_runs(user_id, started_at DESC);

NOTIFY pgrst, 'reload schema';
