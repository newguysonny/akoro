-- =============================================================
-- 2026-activity-drafts.sql
-- Activity drafts — the human-in-the-loop half of AI activity creation.
-- The instructor's agent can PREPARE an activity from chat (type, brief,
-- plan, audience hint) but nothing reaches a learner here: a draft is a
-- private proposal. The human previews it (side-by-side with the chat),
-- edits if needed, and only the Assign action — always a human tap —
-- replays the payload through the same create path as the activities
-- workbench (targets, notifications, live ding).
--
-- payload    — the exact bench-shaped create body assign will replay.
-- audience   — what the instructor's prompt asked for, resolved as far as
--              possible server-side (label + ids) for the preview.
-- status     — draft → assigned (assignment_id set) | discarded | expired.
-- source     — ai_chat today; the workbench may file drafts later.
-- =============================================================

CREATE TABLE IF NOT EXISTS activity_drafts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id     UUID,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  subject       TEXT,
  topic         TEXT,
  payload       JSONB NOT NULL DEFAULT '{}',
  audience      JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'draft',
  assignment_id UUID,
  source        TEXT NOT NULL DEFAULT 'ai_chat',
  session_id    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_activity_drafts_instructor ON activity_drafts(created_by, status);

GRANT ALL ON activity_drafts TO service_role;
NOTIFY pgrst, 'reload schema';
