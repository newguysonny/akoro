-- =============================================================
-- 2026-agent-reply-ratings.sql — Grand Plan Phase 18 item 4: a thumbs up /
-- down (with an optional short reason) on each Agent Chat reply and each
-- workflow summary.
--
--   edu.agent_message_ratings   one row per (learner, surface, message);
--                               set and cleared by the learner on their own
--                               message only (modules/agent-ratings/).
--                               NEVER read by anything that builds a model
--                               prompt (pinned by agent-ratings.contract test).
--   edu.agent_episodes          gains the human label, next to the verdict
--                               code computed. The episode still holds no user
--                               id: it is found by label_key, a keyed hash of
--                               the rated message (agent-ratings/ratings.js),
--                               and the label carries only the rating and a
--                               scrubbed reason — under the same opt-out and
--                               mode rules as the episode itself (SPEC §9).
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.agent_message_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  surface     text NOT NULL CHECK (surface IN ('agent_chat', 'workflow_summary')),
  message_id  uuid NOT NULL,
  rating      text NOT NULL CHECK (rating IN ('up', 'down')),
  reason      text CHECK (reason IS NULL OR char_length(reason) <= 280),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_message_ratings_message
  ON edu.agent_message_ratings (learner_id, surface, message_id);
CREATE INDEX IF NOT EXISTS idx_agent_message_ratings_surface
  ON edu.agent_message_ratings (surface, rating, updated_at DESC);
ALTER TABLE edu.agent_message_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON edu.agent_message_ratings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.agent_message_ratings TO service_role;

ALTER TABLE edu.agent_episodes ADD COLUMN IF NOT EXISTS label_key text;
ALTER TABLE edu.agent_episodes ADD COLUMN IF NOT EXISTS human_label jsonb;
ALTER TABLE edu.agent_episodes ADD COLUMN IF NOT EXISTS human_label_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_agent_episodes_label_key ON edu.agent_episodes (label_key) WHERE label_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';
