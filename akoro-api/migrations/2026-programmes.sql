-- 2026-programmes.sql — the Program Courses section (Akoro Admin)
--
-- Generic academic-programme tables behind /api/programmes: programmes hold
-- SECTIONS (the prototype's years), sections hold COURSES, courses hold
-- learning MATERIALS. Idempotent on every deploy (schema group).
--
-- The existing PHARM.D catalogue (edu.pharmd_*, seeded by
-- 2026-pharmd-courses.sql and filled by scripts/upload-pharmd-courses.mjs)
-- is CONNECTED as a programme: one import copies it into these tables with
-- source links (programmes.source='pharmd', source_programme_id /
-- source_course_id / source_topic_id), so the admin section can manage it
-- with the same UI as any other programme while the learner Pharm.D pages
-- keep reading their own tables. The import is guarded by NOT EXISTS on the
-- source ids, so re-running never duplicates.

CREATE TABLE IF NOT EXISTS edu.programmes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  code               TEXT,
  description        TEXT,
  duration_label     TEXT,
  cover_url          TEXT,                 -- data URL or object URL (admin-uploaded preview)
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  source             TEXT NOT NULL DEFAULT 'custom', -- 'custom' | 'pharmd'
  source_programme_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.programme_sections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES edu.programmes(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,              -- 'First Year', 'Semester 1', …
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (programme_id, name)
);
CREATE INDEX IF NOT EXISTS idx_programme_sections_programme
  ON edu.programme_sections(programme_id, position);

CREATE TABLE IF NOT EXISTS edu.programme_courses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id     UUID NOT NULL REFERENCES edu.programmes(id) ON DELETE CASCADE,
  section_id       UUID NOT NULL REFERENCES edu.programme_sections(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  title            TEXT,
  instructor       TEXT,
  color            INTEGER NOT NULL DEFAULT 0,  -- index into the six card gradients
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  position         INTEGER NOT NULL DEFAULT 0,
  source_course_id UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_programme_courses_section
  ON edu.programme_courses(section_id, position);
CREATE INDEX IF NOT EXISTS idx_programme_courses_programme
  ON edu.programme_courses(programme_id);

CREATE TABLE IF NOT EXISTS edu.programme_materials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       UUID NOT NULL REFERENCES edu.programme_courses(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'pdf'
                    CHECK (type IN ('pdf','video','audio','note','link','slides')),
  meta            TEXT,                    -- '1.6 MB' or '18 min'
  url             TEXT,                    -- null until a file/URL is attached
  thumb_url       TEXT,                    -- optional preview image
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  position        INTEGER NOT NULL DEFAULT 0,
  source_topic_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_programme_materials_course
  ON edu.programme_materials(course_id, position);

CREATE TABLE IF NOT EXISTS edu.programme_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  headline   TEXT NOT NULL,
  detail     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Connect the PHARM.D catalogue as a programme (idempotent import) ──────
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

-- A first log line, once, so the home Updates list is never empty on a fresh
-- environment with the Pharm.D import.
INSERT INTO edu.programme_log (headline, detail)
SELECT 'Programme connected', 'Pharm.D was imported from the PHARM.D catalogue — years, courses and topics.'
WHERE EXISTS (SELECT 1 FROM edu.programmes WHERE source = 'pharmd')
  AND NOT EXISTS (SELECT 1 FROM edu.programme_log);
