-- =============================================================
-- 2026-pharmd-courses.sql
-- The PHARM.D programme catalogue — the pilot's real course
-- structure (years → courses → topics), built to back the learner
-- app's Pharm D discovery pages (programme browse → course folder
-- → topic reader) and to load course packages straight from the
-- reference zips.
--
-- pharmd_programmes — the degree programme itself. PHARM.D today;
--              the same shape holds any future programme.
-- pharmd_years   — a labelled year of the programme. Years are rows
--              (not a column) so an empty year still renders as
--              "coming soon" in the browse view.
-- pharmd_courses — one row per course (BIO 111 …), ordered within
--              its year. code is unique programme-wide. title is
--              the course's name where the pilot data carries one
--              (GST 113 — Nigerian Peoples and Culture); NULL falls
--              back to the code, which is what the reference UI
--              displays anyway.
-- pharmd_topics — one row per topic: position + title parsed from
--              the package file names by scripts/upload-pharmd-
--              courses.mjs, plus the Supabase Storage object
--              (bucket/path/size/mime) holding the topic PDF.
--              The uploader is idempotent — re-running re-uploads
--              with upsert and re-writes the same rows.
-- pharmd_topic_progress — per-learner completion, so the folder's
--              done-checks and "Mark as complete" survive devices.
--              One row = one learner marked one topic done.
--
-- API shape this backs (modules/pharmd/routes.js):
--   GET /api/pharmd/programme     years + courses + topic counts
--   GET /api/pharmd/courses/:code course + topics (public PDF urls)
--   GET /api/pharmd/progress      my done topic ids
--   POST /api/pharmd/topics/:id/complete   done toggle
--
-- The course PDFs live in the public "pharmd-courses" Storage
-- bucket (created by the uploader, like every other bucket in the
-- app), one object per topic: "BIO 111/01 - Cell Structure and
-- Organization.pdf".
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.pharmd_programmes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,        -- 'PHARMD'
  name       TEXT NOT NULL,               -- 'PHARM.D'
  subtitle   TEXT,                        -- 'Doctor of Pharmacy'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edu.pharmd_years (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES edu.pharmd_programmes(id) ON DELETE CASCADE,
  number       INTEGER NOT NULL,          -- 1, 2, …
  label        TEXT NOT NULL,             -- 'First Year'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (programme_id, number)
);

CREATE TABLE IF NOT EXISTS edu.pharmd_courses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES edu.pharmd_programmes(id) ON DELETE CASCADE,
  year_id      UUID NOT NULL REFERENCES edu.pharmd_years(id) ON DELETE CASCADE,
  code         TEXT NOT NULL UNIQUE,      -- 'BIO 111'
  title        TEXT,                      -- NULL → the UI shows the code
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pharmd_courses_year
  ON edu.pharmd_courses(year_id, sort_order);

CREATE TABLE IF NOT EXISTS edu.pharmd_topics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    UUID NOT NULL REFERENCES edu.pharmd_courses(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,          -- 1-based, drives the folder list
  title        TEXT NOT NULL,
  read_minutes INTEGER,                   -- NULL until someone sets it
  file_bucket  TEXT NOT NULL DEFAULT 'pharmd-courses',
  file_path    TEXT,                      -- 'BIO 111/01 - ….pdf' (Storage object)
  file_name    TEXT,                      -- original package file name
  file_size    INTEGER,
  file_mime    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, position)
);

CREATE INDEX IF NOT EXISTS idx_pharmd_topics_course
  ON edu.pharmd_topics(course_id, position);

CREATE TABLE IF NOT EXISTS edu.pharmd_topic_progress (
  user_id    UUID NOT NULL,
  topic_id   UUID NOT NULL REFERENCES edu.pharmd_topics(id) ON DELETE CASCADE,
  done       BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_pharmd_progress_user
  ON edu.pharmd_topic_progress(user_id);

-- ── Seed: the pilot's static structure ─────────────────────────
-- Idempotent: ON CONFLICT DO NOTHING, so re-running never duplicates
-- and never fights rows the uploader may have already written.

INSERT INTO edu.pharmd_programmes (code, name, subtitle)
VALUES ('PHARMD', 'PHARM.D', 'Doctor of Pharmacy')
ON CONFLICT (code) DO NOTHING;

INSERT INTO edu.pharmd_years (programme_id, number, label)
SELECT p.id, y.number, y.label
FROM (VALUES (1, 'First Year'), (2, 'Second Year')) AS y(number, label)
JOIN edu.pharmd_programmes p ON p.code = 'PHARMD'
ON CONFLICT (programme_id, number) DO NOTHING;

-- First Year's nine courses (reference/PHARM.D PILOT PROGRAMME COURSES).
INSERT INTO edu.pharmd_courses (programme_id, year_id, code, title, sort_order)
SELECT p.id, y.id, c.code, c.title, c.ord
FROM (VALUES
  ('BIO 111', NULL::text, 1),
  ('BIO 121', NULL::text, 2),
  ('CSC 111', NULL::text, 3),
  ('GST 111', NULL::text, 4),
  ('GST 113', 'Nigerian Peoples and Culture', 5),
  ('GST 121', NULL::text, 6),
  ('ICH 111', NULL::text, 7),
  ('MAT 111', NULL::text, 8),
  ('PHY 111', NULL::text, 9)
) AS c(code, title, ord)
JOIN edu.pharmd_programmes p ON p.code = 'PHARMD'
JOIN edu.pharmd_years y ON y.programme_id = p.id AND y.number = 1
ON CONFLICT (code) DO NOTHING;
