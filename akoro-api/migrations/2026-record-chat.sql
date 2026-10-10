-- =============================================================
-- 2026-record-chat.sql
--
-- "Ask" in the reader: a learner's questions about ONE document,
-- answered from passages found anywhere in it, with numbered
-- citations that jump to the page + box (documents) or the moment
-- (recordings).
--
-- One private thread per (learner, document). record_id is the
-- record whose search chunks answered — for a shared file that is
-- the OWNER's record (the chunks live there), while user_id stays
-- the learner asking, so every opener's thread is their own.
--
-- citations: [{ n, pageNumber, bbox:[x1,y1,x2,y2] (0-1000),
--               startMs, endMs, quote }] — only the markers the
-- answer actually used. selection: the passage the learner pinned
-- with "Ask about this" ({ pageNumber, text }), if any.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.record_chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  record_id   UUID NOT NULL REFERENCES edu.records(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text        TEXT NOT NULL DEFAULT '',
  citations   JSONB NOT NULL DEFAULT '[]'::jsonb,
  selection   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS record_chat_messages_thread_idx
  ON edu.record_chat_messages(user_id, record_id, created_at);
