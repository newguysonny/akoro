-- =============================================================
-- 2026-community-activities.sql — community activities + submissions
--
-- A community activity is work its creator posts to the community
-- (an assignment/reading/etc.): name, subject, class, due date-time,
-- instructions. Members submit their work once; re-submitting
-- updates the same row (latest submission wins).
--
-- The learner app's community Activity page renders these with:
-- name, creator, due date & time, class, subject, creation date and
-- total submissions.
--
-- Idempotent; safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.community_activities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID NOT NULL REFERENCES edu.communities(id) ON DELETE CASCADE,
  creator_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  subject       TEXT,
  class_name    TEXT,
  due_at        TIMESTAMPTZ,
  instructions  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edu_community_activities_community
  ON edu.community_activities(community_id);
CREATE INDEX IF NOT EXISTS idx_edu_community_activities_due
  ON edu.community_activities(due_at) WHERE due_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS edu.community_activity_submissions (
  activity_id   UUID NOT NULL REFERENCES edu.community_activities(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_edu_community_act_subs_user
  ON edu.community_activity_submissions(user_id);

NOTIFY pgrst, 'reload schema';
