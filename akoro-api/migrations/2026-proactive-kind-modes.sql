-- =============================================================
-- 2026-proactive-kind-modes.sql — Grand Plan Phase 18 item 1: watch-only
-- mode for proactive work.
--
-- · agent_kind_modes: one row per proactive proposal kind (learner and
--   instructor), mode off | observe | live, who set it and when. Every kind
--   that existed before this file is seeded `live` (nothing a learner gets
--   today changes); a kind added later and not listed here is `observe` by
--   code default (modules/autonomy/kindModesCore.js).
--   An optional scope: scope_mode applies to the learners in
--   scope_user_ids and to everyone in scope_school_ids (e.g. live for one
--   school while observe for everyone else).
-- · agent_kind_mode_changes: the history of every switch (admin, audited).
-- · agent_observations: "would have proposed X to learner Y because …" —
--   never shown to the learner, never charged to them, never counted
--   against their caps or quiet hours.
-- · autonomy_runs.observe_only: a run in which nothing could be shown
--   (every kind off or observe for that learner) — its cost is not the
--   learner's budget and it does not count against their run caps.
-- Idempotent; safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.agent_kind_modes (
  kind             text PRIMARY KEY,
  audience         text NOT NULL DEFAULT 'learner' CHECK (audience IN ('learner', 'instructor')),
  mode             text NOT NULL DEFAULT 'observe' CHECK (mode IN ('off', 'observe', 'live')),
  scope_mode       text CHECK (scope_mode IS NULL OR scope_mode IN ('off', 'observe', 'live')),
  scope_user_ids   uuid[] NOT NULL DEFAULT '{}',
  scope_school_ids uuid[] NOT NULL DEFAULT '{}',
  note             text,
  updated_by       uuid,
  updated_by_label text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Every kind that exists today: live, exactly as before. ON CONFLICT keeps an admin's later choice.
INSERT INTO edu.agent_kind_modes (kind, audience, mode, note) VALUES
  ('task', 'learner', 'live', 'existing kind — live by default'),
  ('session', 'learner', 'live', 'existing kind — live by default'),
  ('goal', 'learner', 'live', 'existing kind — live by default'),
  ('practice', 'learner', 'live', 'existing kind — live by default'),
  ('quiz_from_records', 'learner', 'live', 'existing kind — live by default'),
  ('teach_weak_topic', 'learner', 'live', 'existing kind — live by default'),
  ('study_plan', 'learner', 'live', 'existing kind — live by default'),
  ('revision_battle', 'learner', 'live', 'existing kind — live by default'),
  ('follow_up_question', 'learner', 'live', 'existing kind — live by default'),
  ('goal_nudge', 'learner', 'live', 'existing kind — live by default'),
  ('fix_it', 'learner', 'live', 'existing kind — live by default'),
  ('idea', 'learner', 'live', 'existing kind — live by default'),
  ('revise_low_scores', 'instructor', 'live', 'existing kind — live by default'),
  ('chase_missing', 'instructor', 'live', 'existing kind — live by default'),
  ('next_activity', 'instructor', 'live', 'existing kind — live by default')
ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS edu.agent_kind_mode_changes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,
  before       jsonb,
  after        jsonb NOT NULL,
  changed_by   uuid,
  changed_by_label text,
  note         text,
  changed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_kind_mode_changes_kind ON edu.agent_kind_mode_changes(kind, changed_at DESC);

CREATE TABLE IF NOT EXISTS edu.agent_observations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,
  audience   text NOT NULL DEFAULT 'learner',
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  run_id     uuid,
  title      text NOT NULL,
  reason     text,
  preview    jsonb,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_observations_kind ON edu.agent_observations(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_observations_user ON edu.agent_observations(user_id, created_at DESC);

ALTER TABLE edu.autonomy_runs ADD COLUMN IF NOT EXISTS observe_only boolean NOT NULL DEFAULT false;
ALTER TABLE edu.autonomy_runs ADD COLUMN IF NOT EXISTS observed integer NOT NULL DEFAULT 0;

GRANT SELECT, INSERT, UPDATE, DELETE ON edu.agent_kind_modes TO service_role;
GRANT SELECT, INSERT ON edu.agent_kind_mode_changes TO service_role;
GRANT SELECT, INSERT, DELETE ON edu.agent_observations TO service_role;

NOTIFY pgrst, 'reload schema';
