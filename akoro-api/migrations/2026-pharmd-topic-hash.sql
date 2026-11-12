-- =============================================================
-- 2026-pharmd-topic-hash.sql — version the PHARM.D content key.
--
-- A topic PDF can be replaced at the same Storage path. The shared parse
-- cache is keyed by pharmd:<path>; adding the SHA-256 of the bytes makes a
-- replacement a NEW key, so stale markdown is never served. NULL until the
-- uploader/backfill hashes the file (the legacy path-only key keeps working).
-- Idempotent.
-- =============================================================

alter table edu.pharmd_topics
  add column if not exists file_hash text;

comment on column edu.pharmd_topics.file_hash is
  'SHA-256 (hex) of the stored PDF bytes; part of the shared extraction key (pharmd:<path>#<hash>).';
