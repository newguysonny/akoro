-- =============================================================
-- 2026-ensure-community-tables.sql
--
-- Reconcile the Community data model for installations where the
-- API routes are present but PostgREST cannot see one or more of
-- the Community relations yet. This repeats the additive DDL on
-- purpose: every statement is idempotent and it makes a current
-- deployment able to repair a partially-applied earlier rollout.
-- =============================================================

CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.communities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  emoji        TEXT,
  owner_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  is_public    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.community_members (
  community_id UUID NOT NULL REFERENCES edu.communities(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id),
  CHECK (role IN ('owner', 'member'))
);

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

CREATE TABLE IF NOT EXISTS edu.community_activity_submissions (
  activity_id   UUID NOT NULL REFERENCES edu.community_activities(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_edu_communities_owner
  ON edu.communities(owner_id);
CREATE INDEX IF NOT EXISTS idx_edu_community_members_user
  ON edu.community_members(user_id);
CREATE INDEX IF NOT EXISTS idx_edu_community_activities_community
  ON edu.community_activities(community_id);
CREATE INDEX IF NOT EXISTS idx_edu_community_activities_due
  ON edu.community_activities(due_at) WHERE due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_edu_community_act_subs_user
  ON edu.community_activity_submissions(user_id);
