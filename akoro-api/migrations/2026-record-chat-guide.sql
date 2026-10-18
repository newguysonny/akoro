-- =============================================================
-- 2026-record-chat-guide.sql
--
-- "Learning with Guide" in the reader: the guide teacher's chat with a
-- learner about ONE document, grounded in it like Ask (numbered
-- citations that jump to the page). Same table as Ask, its own thread:
-- channel 'ask' (the reader's Ask tab) or 'guide' (the guide chat).
-- Existing rows are Ask's.
-- =============================================================

ALTER TABLE edu.record_chat_messages
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'ask';

DO $$ BEGIN
  ALTER TABLE edu.record_chat_messages
    ADD CONSTRAINT record_chat_messages_channel_check CHECK (channel IN ('ask', 'guide'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS record_chat_messages_channel_idx
  ON edu.record_chat_messages(user_id, record_id, channel, created_at);

-- The API reads through PostgREST: reload its schema cache so `channel` is seen.
NOTIFY pgrst, 'reload schema';
