-- =============================================================
-- 2026-pharmd-unified.sql
-- Unify PHARM.D management into the generic Program Courses tables
-- (edu.programmes / programme_sections / programme_courses /
-- programme_materials), so the admin Program Courses section manages
-- the Pharm.D programme end to end and the learner Pharm.D endpoints
-- (/api/pharmd/*) read the SAME rows the admin edits.
--
-- What this does — additive only, nothing is dropped or rewritten:
--   1. programme_materials gains file_path / file_hash: the Storage
--      identity of an attached PDF, so a material can carry the same
--      versioned content key (pharmd:<path>#<hash>) the reader's
--      shared parse cache already uses.
--   2. The PHARM.D import from 2026-programmes.sql is RE-RUN with its
--      original NOT EXISTS guards, so anything the uploader added to
--      the pharmd tables after the first import is picked up; then
--      file_path / file_hash are backfilled onto imported materials
--      from their source topics.
--   3. A material-keyed progress table is created and backfilled
--      from edu.pharmd_topic_progress through the source links, so
--      every learner's done-checks survive the switch.
--
-- The edu.pharmd_* tables are left untouched: they are the read
-- fallback if AKORO_PHARMD_UNIFIED=false is ever set, and the
-- uploader's source links (source_topic_id) keep pointing at them.
-- Idempotent: safe to re-run.
-- =============================================================

ALTER TABLE edu.programme_materials ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE edu.programme_materials ADD COLUMN IF NOT EXISTS file_hash TEXT;

-- ── Refresh the PHARM.D import (same statements as 2026-programmes.sql) ──
INSERT INTO edu.programmes (name, code, description, duration_label, status, source, source_programme_id)
SELECT p.name, p.code, coalesce(p.subtitle, ''), '6 years', 'published', 'pharmd', p.id
FROM edu.pharmd_programmes p
WHERE NOT EXISTS (
  SELECT 1 FROM edu.programmes x
  WHERE x.source = 'pharmd' AND x.source_programme_id = p.id
);

INSERT INTO edu.programme_sections (programme_id, name, position)
SELECT gp.id, y.label, y.number
FROM edu.pharmd_years y
JOIN edu.programmes gp ON gp.source = 'pharmd' AND gp.source_programme_id = y.programme_id
WHERE NOT EXISTS (
  SELECT 1 FROM edu.programme_sections s
  WHERE s.programme_id = gp.id AND s.name = y.label
);

INSERT INTO edu.programme_courses (programme_id, section_id, code, title, instructor, color, status, position, source_course_id)
SELECT gp.id, s.id, pc.code, coalesce(pc.title, pc.code), 'Akoro',
       ((row_number() OVER (ORDER BY pc.sort_order, pc.code)) - 1) % 6,
       'published', pc.sort_order, pc.id
FROM edu.pharmd_courses pc
JOIN edu.programmes gp ON gp.source = 'pharmd' AND gp.source_programme_id = pc.programme_id
JOIN edu.programme_sections s ON s.programme_id = gp.id
JOIN edu.pharmd_years y ON y.id = pc.year_id AND s.name = y.label
WHERE NOT EXISTS (
  SELECT 1 FROM edu.programme_courses c WHERE c.source_course_id = pc.id
);

INSERT INTO edu.programme_materials (course_id, title, type, meta, status, position, source_topic_id)
SELECT c.id, t.title, 'pdf',
       coalesce(
         CASE WHEN t.read_minutes IS NOT NULL THEN (t.read_minutes::text || ' min') END,
         CASE WHEN t.file_size IS NOT NULL THEN (round(t.file_size / 1048576.0, 1)::text || ' MB') END
       ),
       'published', t.position, t.id
FROM edu.pharmd_topics t
JOIN edu.programme_courses c ON c.source_course_id = t.course_id
WHERE NOT EXISTS (
  SELECT 1 FROM edu.programme_materials m WHERE m.source_topic_id = t.id
);

-- Backfill the file identity onto imported materials (existing + new),
-- so the unified read path never has to join back to pharmd_topics.
UPDATE edu.programme_materials m
SET file_path = t.file_path, file_hash = t.file_hash
FROM edu.pharmd_topics t
WHERE m.source_topic_id = t.id
  AND m.file_path IS NULL
  AND t.file_path IS NOT NULL;

-- ── Progress, keyed by material ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.programme_material_progress (
  user_id     UUID NOT NULL,
  material_id UUID NOT NULL REFERENCES edu.programme_materials(id) ON DELETE CASCADE,
  done        BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, material_id)
);
CREATE INDEX IF NOT EXISTS idx_programme_material_progress_user
  ON edu.programme_material_progress(user_id);

INSERT INTO edu.programme_material_progress (user_id, material_id, done, updated_at)
SELECT p.user_id, m.id, p.done, p.updated_at
FROM edu.pharmd_topic_progress p
JOIN edu.programme_materials m ON m.source_topic_id = p.topic_id
WHERE p.done
ON CONFLICT (user_id, material_id) DO NOTHING;
