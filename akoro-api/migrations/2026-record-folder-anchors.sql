-- =============================================================
-- 2026-record-folder-anchors.sql
--
-- Reader items can now be anchored to a FOLDER as well as a record:
-- the folder reader builds study tools (summary / quiz / flashcards /
-- podcast) and keeps an Ask thread over the folder's whole contents.
--
-- record_artifacts and record_chat_messages each gain a folder_id
-- anchor; record_id becomes nullable, and a row must carry exactly
-- one anchor. Rows made over a folder cite their source documents in
-- the content/citations payloads, not through the anchor.
-- =============================================================

ALTER TABLE edu.record_artifacts
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES edu.library_folders(id) ON DELETE CASCADE;
ALTER TABLE edu.record_artifacts
  ALTER COLUMN record_id DROP NOT NULL;
ALTER TABLE edu.record_artifacts
  DROP CONSTRAINT IF EXISTS record_artifacts_anchor_check;
ALTER TABLE edu.record_artifacts
  ADD CONSTRAINT record_artifacts_anchor_check
  CHECK ((record_id IS NOT NULL) <> (folder_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS record_artifacts_folder_idx
  ON edu.record_artifacts(user_id, folder_id, created_at);

ALTER TABLE edu.record_chat_messages
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES edu.library_folders(id) ON DELETE CASCADE;
ALTER TABLE edu.record_chat_messages
  ALTER COLUMN record_id DROP NOT NULL;
ALTER TABLE edu.record_chat_messages
  DROP CONSTRAINT IF EXISTS record_chat_messages_anchor_check;
ALTER TABLE edu.record_chat_messages
  ADD CONSTRAINT record_chat_messages_anchor_check
  CHECK ((record_id IS NOT NULL) <> (folder_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS record_chat_messages_folder_idx
  ON edu.record_chat_messages(user_id, folder_id, created_at);
