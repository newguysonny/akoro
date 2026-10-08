-- =============================================================
-- 2026-community-items.sql
-- Community items — what the "Add to community" page puts in a
-- community. Any content in the app can land in a community the
-- learner has joined: a library record (upload/link/paste), a
-- Pharm.D topic, a course lesson (video), or a library shelf
-- item (course/blog).
--
-- item_type + item_ref identify the source row; the display
-- snapshot (title, sub, kind, link) is stored at ADD time so the
-- community page renders instantly and never re-queries every
-- surface — and an item keeps its shape even if the source row
-- later changes or its surface gains a new shape.
--   kind   icon hint: pdf | audio | video | image | text | link |
--          paste | blog | course | topic …
--   link   optional in-app deep link (/course/<slug>, /write/blog/
--          <id>) so an item can reopen its source; Pharm.D topics
--          live in a modal, not a route, so they carry none.
--
-- UNIQUE (community_id, item_type, item_ref) — adding the same
-- thing twice is a no-op (the page multi-selects communities, not
-- items). Items die with the community AND the learner.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.community_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES edu.communities(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  item_type    TEXT NOT NULL CHECK (item_type IN ('record', 'pharmd_topic', 'lesson', 'library')),
  item_ref     TEXT NOT NULL,
  title        TEXT NOT NULL,
  sub          TEXT,
  kind         TEXT,
  link         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (community_id, item_type, item_ref)
);

CREATE INDEX IF NOT EXISTS idx_edu_community_items_community
  ON edu.community_items(community_id, created_at DESC);

-- The Data API (service_role) must see the new relation, and PostgREST
-- must rebuild its caches after an additive table — the same treatment
-- the base community tables got in 2026-community-schema-cache-refresh.sql.
GRANT USAGE ON SCHEMA edu TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE edu.community_items TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
