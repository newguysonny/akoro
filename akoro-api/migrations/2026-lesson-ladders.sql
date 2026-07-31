-- =============================================================
-- 2026-lesson-ladders.sql
-- Cached, provenance-tagged lesson ladders (foundation → advanced subtopics +
-- objectives) for adaptive sessions.
--
-- A ladder is a REUSABLE artifact keyed by (school, class, subject, topic), so
-- teacher review improves it once for every future learner. Review NEVER blocks
-- a session: a freshly generated ladder is served immediately and simply
-- carries its provenance tier.
--
--   provenance: scheme_of_work  — built from the school's own teacher-authored
--                                 scheme of work (highest trust, auto-approved)
--               syllabus        — grounded in WAEC/JAMB/NECO syllabus content
--               ai              — model knowledge only (lowest trust)
--   status:     approved | pending_review | rejected
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.lesson_ladders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID REFERENCES public.school_profiles(id) ON DELETE CASCADE,
  class_id      UUID,                       -- mgmt.classes id (no cross-schema FK)
  subject       TEXT NOT NULL,
  topic_key     TEXT NOT NULL,              -- lower(trim(topic)) — the cache key
  topic         TEXT NOT NULL,              -- original display casing
  subtopics     JSONB NOT NULL DEFAULT '[]',
  objectives    JSONB NOT NULL DEFAULT '{}',
  provenance    TEXT NOT NULL DEFAULT 'ai'
                  CHECK (provenance IN ('scheme_of_work','syllabus','ai')),
  refs          JSONB NOT NULL DEFAULT '[]',   -- source citations for the chip
  status        TEXT NOT NULL DEFAULT 'pending_review'
                  CHECK (status IN ('approved','pending_review','rejected')),
  reviewed_by   UUID,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  use_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One ladder per (school, class, subject, topic). COALESCE keeps the uniqueness
-- meaningful for standalone learners (no school/class).
CREATE UNIQUE INDEX IF NOT EXISTS uq_lesson_ladder_key ON edu.lesson_ladders (
  COALESCE(school_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(class_id,  '00000000-0000-0000-0000-000000000000'::uuid),
  lower(subject), topic_key
);
CREATE INDEX IF NOT EXISTS idx_lesson_ladder_review
  ON edu.lesson_ladders (school_id, status, created_at DESC);

NOTIFY pgrst, 'reload schema';
