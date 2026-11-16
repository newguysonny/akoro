-- =============================================================
-- 2026-pharmd-material-filemeta.sql
-- Exact file metadata for programme materials. The Pharm.D import
-- (2026-programmes.sql) stored only a display string in meta
-- ('1.6 MB' / '18 min'), so reading size/minutes back out of it is
-- lossy. Give materials the real numbers, backfilled from their
-- source topics; the uploader writes them exactly from now on.
-- Additive + idempotent, like 2026-pharmd-unified.sql.
-- =============================================================

ALTER TABLE edu.programme_materials ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE edu.programme_materials ADD COLUMN IF NOT EXISTS read_minutes INTEGER;

UPDATE edu.programme_materials m
SET file_size = t.file_size, read_minutes = t.read_minutes
FROM edu.pharmd_topics t
WHERE m.source_topic_id = t.id
  AND m.file_size IS NULL
  AND (t.file_size IS NOT NULL OR t.read_minutes IS NOT NULL);
