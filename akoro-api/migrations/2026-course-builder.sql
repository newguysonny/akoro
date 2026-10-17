-- 2026-course-builder.sql — the Course Creator section (Akoro Instructor)
--
-- Instructor-built marketplace courses behind /api/course-builder, ported
-- 1:1 from reference/Kpemu Course Builder.html: courses (video or live)
-- hold SECTIONS, sections hold LESSONS (content items). Live lessons carry
-- the reference's scheduling vocabulary — start/end wall-clock times, a
-- repeat rule with an optional end date and second daily session, and a
-- per-occurrence exception map (cancelled / rescheduled dates) stored as
-- JSONB exactly as the prototype keeps it.
--
-- Times are TEXT on purpose: the prototype's datetime-local strings
-- ("2026-10-22T16:00", "17:00") are wall-clock values with no timezone,
-- and the builder round-trips them verbatim.
--
-- Review flow: draft → review → published. Instructors own their courses
-- (owner_id) and submit for review; admins publish or request changes
-- (review_note). Idempotent on every deploy (schema group).

CREATE TABLE IF NOT EXISTS edu.builder_courses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     UUID NOT NULL,              -- users.id (the instructor)
  title        TEXT NOT NULL,
  subtitle     TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'Other',
  level        TEXT NOT NULL DEFAULT 'Beginner',
  language     TEXT NOT NULL DEFAULT 'English',
  tags         TEXT NOT NULL DEFAULT '',   -- comma separated, free text
  type         TEXT NOT NULL DEFAULT 'video' CHECK (type IN ('video','live')),
  platform     TEXT,                       -- default live platform
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published')),
  price        TEXT NOT NULL DEFAULT '',   -- '' (unset) | 'free' | numeric string (naira)
  preview_mode BOOLEAN NOT NULL DEFAULT false,  -- pm: free and public, no enrollment
  description  TEXT NOT NULL DEFAULT '',
  learn        TEXT NOT NULL DEFAULT '',   -- what students will learn, one per line
  color        INTEGER NOT NULL DEFAULT 0, -- index into the six card gradients
  cover_url    TEXT,                       -- data URL or object URL (shrunk preview)
  review_note  TEXT NOT NULL DEFAULT '',   -- admin's "changes requested" note
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_builder_courses_owner
  ON edu.builder_courses(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_builder_courses_status
  ON edu.builder_courses(status);

CREATE TABLE IF NOT EXISTS edu.builder_sections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  UUID NOT NULL REFERENCES edu.builder_courses(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_builder_sections_course
  ON edu.builder_sections(course_id, position);

CREATE TABLE IF NOT EXISTS edu.builder_lessons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id  UUID NOT NULL REFERENCES edu.builder_sections(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'video'
                CHECK (type IN ('live','video','pdf','audio','article','link','slides')),
  meta        TEXT NOT NULL DEFAULT '',    -- '1.6 MB' or '18 min'
  src         TEXT NOT NULL DEFAULT '',    -- link / meeting URL
  description TEXT NOT NULL DEFAULT '',
  free        BOOLEAN NOT NULL DEFAULT false,  -- free preview for everyone
  img_url     TEXT,                        -- optional preview image
  when_at     TEXT NOT NULL DEFAULT '',    -- live: 'YYYY-MM-DDTHH:MM' (wall clock)
  end_time    TEXT NOT NULL DEFAULT '',    -- live: 'HH:MM'
  platform    TEXT,                        -- live platform for this session
  rep         TEXT NOT NULL DEFAULT '',    -- '' | daily | twice | weekly | biweekly | monthly
  rep_until   TEXT NOT NULL DEFAULT '',    -- 'YYYY-MM-DD' (optional)
  t2s         TEXT NOT NULL DEFAULT '',    -- twice-a-day: second session start 'HH:MM'
  t2e         TEXT NOT NULL DEFAULT '',    -- twice-a-day: second session end 'HH:MM'
  ex          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- per-occurrence exceptions
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_builder_lessons_section
  ON edu.builder_lessons(section_id, position);
