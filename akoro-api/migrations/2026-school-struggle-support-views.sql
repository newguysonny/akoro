-- ============================================================================
-- 2026-school-struggle-support-views.sql
-- Grand Plan D39: a school sees its linked learners' non-sensitive struggles;
-- sensitive ones show only as a "may need support" flag, and every opening of
-- that flag's detail is logged here first (who, when, which learner). The
-- route refuses to show the detail when this insert fails.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS mgmt;

CREATE TABLE IF NOT EXISTS mgmt.struggle_support_views (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  viewer_user_id  uuid NOT NULL,                       -- public.users id of the admin / teacher
  viewer_role     text,
  student_id      uuid NOT NULL REFERENCES mgmt.students(id) ON DELETE CASCADE,
  types           text[] NOT NULL DEFAULT '{}',        -- the sensitive types shown (no free text)
  opened_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_struggle_support_views_student
  ON mgmt.struggle_support_views (school_id, student_id, opened_at DESC);

GRANT SELECT, INSERT ON mgmt.struggle_support_views TO service_role;
