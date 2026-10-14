-- 2026-programme-course-covers.sql — course cover images (Program Courses)
--
-- Courses get the same optional cover image programmes already have:
-- the admin's Add/Edit Course forms save it, the course tiles show it,
-- and the learner app renders it instead of the colour-gradient fallback.
-- Idempotent on every deploy (schema group); runs after 2026-programmes.sql,
-- which owns edu.programme_courses.

ALTER TABLE edu.programme_courses
  ADD COLUMN IF NOT EXISTS cover_url TEXT;  -- data URL or object URL (admin-uploaded preview)
