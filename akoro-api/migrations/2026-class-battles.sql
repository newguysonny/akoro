-- =============================================================
-- 2026-class-battles.sql
-- Battles that belong to a CLASS and a subject, not a course.
--
-- Until now every battle hung off a course: course_id was NOT NULL and the
-- questions came from that course's question_bank. That works for a learner
-- enrolled on "JSS1 Basic Science" as a course, and not at all for one who
-- simply attends JSS1 and studies Mathematics there — which is most of them in
-- a school. A class battle draws its questions from the past-questions bank by
-- subject instead.
--
-- Two changes, both additive:
--   • course_id becomes nullable (a class battle has no course)
--   • classroom_id records which class it belongs to
--
-- Nothing that reads course_id breaks: the course listings filter ON course_id,
-- so class battles simply don't appear in them, and the leaderboard refresh
-- skips a null course rather than querying for one.
-- =============================================================

ALTER TABLE public.battles ALTER COLUMN course_id DROP NOT NULL;

ALTER TABLE public.battles
  ADD COLUMN IF NOT EXISTS classroom_id uuid REFERENCES public.classrooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_battles_classroom
  ON public.battles(classroom_id, status, created_at DESC);

-- A battle has to be anchored to something, or it belongs to nobody and its
-- questions come from nowhere. Enforce that in the database rather than trusting
-- every future write path to remember.
DO $$
BEGIN
  ALTER TABLE public.battles DROP CONSTRAINT IF EXISTS battles_scope_check;
  ALTER TABLE public.battles ADD CONSTRAINT battles_scope_check
    CHECK (course_id IS NOT NULL OR classroom_id IS NOT NULL);
EXCEPTION WHEN check_violation THEN
  -- Existing rows predate the constraint and all have a course_id, so this
  -- should never fire; if it somehow does, leave the table usable and say so.
  RAISE NOTICE 'battles_scope_check not applied — some rows have neither course_id nor classroom_id.';
END $$;

-- Verify:
-- SELECT battle_type, count(*) FILTER (WHERE course_id IS NULL) AS class_battles,
--        count(*) FILTER (WHERE course_id IS NOT NULL) AS course_battles
-- FROM public.battles GROUP BY battle_type;
