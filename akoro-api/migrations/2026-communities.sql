-- =============================================================
-- 2026-communities.sql — learner communities (higher-ed tier)
--
-- Higher-ed learners (university, college, sixth form, adult, …) group
-- into communities. Each community gets its own Activity page in the
-- learner app (route /communities/:id renders the Activity shell with
-- the community's feed).
--
-- Communities live in the edu schema alongside the rest of the learner
-- learning data. Membership is explicit: the creator is the owner,
-- everyone else is a member. owner_id is denormalised onto the community
-- row itself so ownership survives even if the membership row is touched.
--
-- Idempotent; safe to re-run.
-- =============================================================

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

CREATE INDEX IF NOT EXISTS idx_edu_communities_owner
  ON edu.communities(owner_id);
CREATE INDEX IF NOT EXISTS idx_edu_community_members_user
  ON edu.community_members(user_id);

NOTIFY pgrst, 'reload schema';
