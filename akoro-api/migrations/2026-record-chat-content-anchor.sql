-- Ask threads on catalogue content (PHARM.D topics / programme materials) have
-- no records row. record_chat_messages gains the same exclusive content_key
-- anchor artifacts already use, so the reader's Ask tab can load/save there.
ALTER TABLE edu.record_chat_messages ADD COLUMN IF NOT EXISTS content_key TEXT;
ALTER TABLE edu.record_chat_messages DROP CONSTRAINT IF EXISTS record_chat_messages_anchor_check;
ALTER TABLE edu.record_chat_messages
  ADD CONSTRAINT record_chat_messages_anchor_check
  CHECK (num_nonnulls(record_id, folder_id, content_key) = 1);
CREATE INDEX IF NOT EXISTS record_chat_messages_content_key_idx
  ON edu.record_chat_messages(user_id, content_key, created_at);
