-- =============================================================
-- 2026-material-sorting.sql — Grand Plan §7.17 (D51), sorting chat uploads
--
-- · One message's files are sorted per file: each subject group is its own
--   upload (material_ingests row) under one batch_id, with its own card and Undo.
-- · filing: how the upload was filed — which of the message's files it holds
--   (fileIndexes), two folders that fit (choices), where it was moved from
--   after reading (movedFrom), a subject still unknown (needsSubject,
--   subjectOptions), and Recently deleted (deletedAt, trash, purged).
-- · material_folder_defaults: the folder a learner chose for a subject, so
--   the protégé doesn't ask again.
-- · records.deleted_at: Undo puts an upload in Recently deleted for 30 days
--   (hidden everywhere, restorable); the purge deletes it for good after that.
-- =============================================================

ALTER TABLE edu.material_ingests ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE edu.material_ingests ADD COLUMN IF NOT EXISTS filing jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_material_ingests_batch ON edu.material_ingests(user_id, batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_material_ingests_chat ON edu.material_ingests(user_id, chat_session_id) WHERE chat_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS edu.material_folder_defaults (
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_key  text NOT NULL,
  kind         text NOT NULL DEFAULT '',          -- '' = any kind of file
  folder_id    uuid NOT NULL REFERENCES edu.library_folders(id) ON DELETE CASCADE,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, subject_key, kind)
);

ALTER TABLE edu.records ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_records_deleted ON edu.records(deleted_at) WHERE deleted_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
