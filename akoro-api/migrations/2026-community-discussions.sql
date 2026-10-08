-- =============================================================
-- 2026-community-discussions.sql
-- Community discussions — the persistent, real-time group chat a
-- community owns, surfaced inside the reader on every content the
-- community is connected to.
--
-- OWNERSHIP: the discussion belongs to the COMMUNITY, never to the
-- content. One row per community (UNIQUE community_id) — the same
-- conversation follows the community's materials wherever they open
-- (a PDF, an audio lecture, a video, a doc … anything added to the
-- community via edu.community_items). The content connection is a
-- READ-TIME question ("which of my communities have this item?"),
-- so no content↔discussion link is stored here.
--
-- MESSAGES: append-only chat lines. The body is a trimmed 1..2000
-- char text (group-chat sized). Everything dies with the community
-- (ON DELETE CASCADE) and with its members' user rows.
--
-- Realtime transport lives in the API: POST /:id/discussion/messages
-- broadcasts to the socket.io room `discussion:<communityId>`; the
-- socket gateway (modules/communities/discussionSocket.js) joins a
-- socket into that room only after a membership check.
--
-- Idempotent; safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.community_discussions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id    UUID NOT NULL UNIQUE REFERENCES edu.communities(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.community_discussion_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id UUID NOT NULL REFERENCES edu.community_discussions(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edu_community_discussion_messages_recent
  ON edu.community_discussion_messages(discussion_id, created_at DESC);

-- The Data API (service_role) must see the new tables, and PostgREST
-- must rebuild its caches after additive tables — the same treatment
-- the community tables got in 2026-community-schema-cache-refresh.sql.
GRANT USAGE ON SCHEMA edu TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE edu.community_discussions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE edu.community_discussion_messages TO service_role;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
