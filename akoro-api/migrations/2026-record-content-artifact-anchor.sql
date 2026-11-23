-- Catalogue content (PHARM.D topic PDFs, shared material) is addressed by a
-- content key, not a records row. Study tools made over it need somewhere to
-- live, so record_artifacts gains a third exclusive anchor: content_key.
-- Exactly one of record_id / folder_id / content_key must be set.
ALTER TABLE edu.record_artifacts ADD COLUMN IF NOT EXISTS content_key TEXT;
ALTER TABLE edu.record_artifacts DROP CONSTRAINT IF EXISTS record_artifacts_anchor_check;
ALTER TABLE edu.record_artifacts
  ADD CONSTRAINT record_artifacts_anchor_check
  CHECK (num_nonnulls(record_id, folder_id, content_key) = 1);
CREATE INDEX IF NOT EXISTS record_artifacts_content_key_idx
  ON edu.record_artifacts(user_id, content_key, created_at);
