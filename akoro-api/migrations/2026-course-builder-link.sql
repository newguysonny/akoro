-- 2026-course-builder-link.sql — one course record (2026-10-20).
--
-- Course Creator (edu.builder_courses) becomes the editor of the platform's
-- course row (public.courses — what learners, payments, live sessions and
-- the agent's tools read). course_id links the two; one builder course per
-- course (UNIQUE), so adopting an old course twice is impossible.
-- See modules/course-builder/link.js. Idempotent (schema group).

ALTER TABLE edu.builder_courses
  ADD COLUMN IF NOT EXISTS course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_builder_courses_course
  ON edu.builder_courses(course_id) WHERE course_id IS NOT NULL;
