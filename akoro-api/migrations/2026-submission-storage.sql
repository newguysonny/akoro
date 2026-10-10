-- =============================================================
-- 2026-submission-storage.sql
-- Activity submissions move to object storage and become ONE PDF.
--
-- self_study_files.storage_key — the attachment's object key (R2, or the
--   Supabase records fallback), under the learner's own prefix. New
--   uploads land there; `data` (base64 in Postgres) is kept only for rows
--   written before this, so it becomes nullable. A row has one or the
--   other.
-- self_study_files.kind — what the bytes really are (sniffed, not the
--   browser's word): pdf | image | docx | text.
-- self_study_targets.submission_pdf — the submission rendered as one PDF
--   (the learner's details, written work, every question with its answer,
--   then the attachments merged in): { key, size, pages, builtFor,
--   builtAt, notes[] }. builtFor is the submission's submittedAt, so a
--   resubmission rebuilds it.
-- =============================================================

ALTER TABLE edu.self_study_files ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE edu.self_study_files ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE edu.self_study_files ALTER COLUMN data DROP NOT NULL;

ALTER TABLE edu.self_study_targets
  ADD COLUMN IF NOT EXISTS submission_pdf JSONB;
