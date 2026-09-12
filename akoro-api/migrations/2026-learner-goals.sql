-- =============================================================
-- 2026-learner-goals.sql — the learner's educational goals model
--
-- Seed: the single agent.goal category in settings graduates into a
-- real table. Goals drive Full Autonomy (docs/learner-full-autonomy-
-- plan.md): the nightly cycle reads them, proposes goal-aligned work,
-- and reports progress. All kinds are education-related by contract —
-- exam targets, subject mastery, habit goals ("study 30 min daily").
--
-- source 'agent' rows are created only when the learner APPROVES an
-- agent proposal (human-in-the-loop; the agent never inserts here on
-- its own).
--
-- Idempotent; safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.learner_goals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  category     TEXT,                       -- Exam Preparation | Concept Mastery | …
  metric       TEXT,                       -- optional measurable ("avg 70% on past questions")
  target_date  DATE,                       -- optional; feeds exam countdowns
  exam         TEXT,                       -- optional exam tag (WAEC/JAMB/NECO…)
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','paused','achieved','dismissed')),
  source       TEXT NOT NULL DEFAULT 'learner'
               CHECK (source IN ('learner','agent')),
  progress_note TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edu_learner_goals_user
  ON edu.learner_goals(user_id, status);

NOTIFY pgrst, 'reload schema';
