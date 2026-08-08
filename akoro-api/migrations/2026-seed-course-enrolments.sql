-- =============================================================
-- 2026-seed-course-enrolments.sql
-- Put the demo class on a demo course, so COURSE battles are possible at all.
--
-- The Battles form offers three types — course, class, study review — but the
-- enrollments table was completely empty: not one row, for any course, in the
-- whole seeded database. So "everyone on the course" resolved to nobody and a
-- course battle answered "Pick at least one learner to challenge", which reads
-- as a bug in the form rather than as missing data. It was never possible to
-- demo or test the type at all.
--
-- Enrol the JSS1 classmates on their teacher's own course. That is the same
-- population as the class battles, which is the point: the two types can then
-- be compared on the same learners, drawing from different question banks.
--
-- Idempotent: guarded by the enrolment that would be created.
-- Requires 2026-seed-school.sql (JSS1) and the demo courses.
-- =============================================================

DO $$
DECLARE
  v_course  uuid;
  v_room    uuid;
  v_added   int := 0;
  r         record;
BEGIN
  SELECT c.id INTO v_course
    FROM public.courses c
    JOIN public.users u ON u.id = c.instructor_id
   WHERE u.email = 'teacher1@demo.akoro.app'
     AND c.title = 'JSS Mathematics'
   LIMIT 1;

  IF v_course IS NULL THEN
    RAISE NOTICE 'JSS Mathematics course not found — skipping course enrolments.';
    RETURN;
  END IF;

  SELECT cl.id INTO v_room
    FROM public.classrooms cl
    JOIN public.school_profiles s ON s.id = cl.school_id
   WHERE s.name = 'Akoro Demo Academy' AND cl.name = 'JSS1'
   LIMIT 1;

  IF v_room IS NULL THEN
    RAISE NOTICE 'JSS1 classroom not found — skipping course enrolments.';
    RETURN;
  END IF;

  FOR r IN
    SELECT cs.user_id
      FROM public.classroom_students cs
     WHERE cs.classroom_id = v_room AND cs.status = 'active'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.enrollments e
       WHERE e.course_id = v_course AND e.user_id = r.user_id
    ) THEN
      INSERT INTO public.enrollments (course_id, user_id, status)
      VALUES (v_course, r.user_id, 'active');
      v_added := v_added + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'course enrolments: % learner(s) added to JSS Mathematics', v_added;
END $$;

-- Verify:
--   SELECT c.title, count(*) FILTER (WHERE e.status = 'active') AS active
--   FROM public.courses c JOIN public.enrollments e ON e.course_id = c.id
--   GROUP BY c.title ORDER BY active DESC;
