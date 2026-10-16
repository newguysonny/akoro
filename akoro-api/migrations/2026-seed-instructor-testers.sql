-- =============================================================
-- 2026-seed-instructor-testers.sql
-- Two demo INSTRUCTORS for the Verification Gate's instructor self-tooling
-- scenarios (phase S7), each with their own class, activities and graded
-- results — so scope tests can prove one instructor never sees the other's.
--
--   tester51  Ms Tola Tester    "Tester Class A": tester01-05, 2 activities
--   tester52  Mr Femi Tester    "Tester Class B": tester06-10, 1 activity
--   Login: tester51@demo.akoro.app / tester52@demo.akoro.app, Password123!
--
-- They are test accounts by the gate's rule (username tester\d\d AND
-- @demo.akoro.app). Idempotent: created once, keyed by email / title.
-- =============================================================
DO $$
DECLARE
  v_pw   text := '$2b$10$HKzqNJTCBHeB0uWSWhf7PeLIOMrlEw2.9oYDI3vQPEs6WAl5Fo7KS'; -- Password123!
  v_t    uuid;
  v_room uuid;
  v_act  uuid;
  v_s    uuid;
  k      int;
  r      record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      (51, 'Tola Tester', 'Tester Class A', 1),
      (52, 'Femi Tester', 'Tester Class B', 6)) AS t(n, name, room, first_student)
  LOOP
    SELECT id INTO v_t FROM public.users WHERE email = format('tester%s@demo.akoro.app', r.n);
    IF v_t IS NULL THEN
      INSERT INTO public.users (email, username, password_hash, full_name, role, is_active, onboarding_completed, email_verified, country)
      VALUES (format('tester%s@demo.akoro.app', r.n), format('tester%s', r.n), v_pw, r.name, 'instructor', true, true, true, 'Nigeria')
      RETURNING id INTO v_t;
    END IF;

    SELECT id INTO v_room FROM public.classrooms WHERE teacher_id = v_t AND name = r.room LIMIT 1;
    IF v_room IS NULL THEN
      INSERT INTO public.classrooms (teacher_id, name, description, student_limit)
      VALUES (v_t, r.room, 'Verification Gate test class', 20) RETURNING id INTO v_room;
    END IF;
    FOR k IN 0..4 LOOP
      SELECT id INTO v_s FROM public.users WHERE email = format('tester%s@demo.akoro.app', lpad((r.first_student + k)::text, 2, '0'));
      IF v_s IS NOT NULL THEN
        INSERT INTO public.classroom_students (classroom_id, user_id, status) VALUES (v_room, v_s, 'active')
        ON CONFLICT (classroom_id, user_id) DO UPDATE SET status = 'active';
      END IF;
    END LOOP;

    -- Activities with per-student results (some graded, some not started).
    FOR k IN 1..(CASE WHEN r.n = 51 THEN 2 ELSE 1 END) LOOP
      SELECT id INTO v_act FROM edu.self_study_assignments
       WHERE created_by = v_t AND title = format('%s · Activity %s', r.room, k) LIMIT 1;
      IF v_act IS NULL THEN
        INSERT INTO edu.self_study_assignments (created_by, classroom_id, title, subject, topic, type, difficulty, due_at, status)
        VALUES (v_t, v_room, format('%s · Activity %s', r.room, k),
                CASE WHEN k = 1 THEN 'Mathematics' ELSE 'Basic Science' END,
                CASE WHEN k = 1 THEN 'Fractions' ELSE 'Energy' END,
                'assignment', 'intermediate', now() + make_interval(days => 7 * k), 'active')
        RETURNING id INTO v_act;
        INSERT INTO edu.self_study_targets (assignment_id, student_id, status, started_at, completed_at, grade, graded_at, graded_by)
        SELECT v_act, u.id,
               CASE WHEN g.i <= 3 THEN 'complete' WHEN g.i = 4 THEN 'started' ELSE 'assigned' END,
               CASE WHEN g.i <= 4 THEN now() - interval '3 days' END,
               CASE WHEN g.i <= 3 THEN now() - interval '2 days' END,
               CASE WHEN g.i <= 3 THEN 50 + g.i * 10 + k * 5 + (r.n - 51) * 3 END,
               CASE WHEN g.i <= 3 THEN now() - interval '1 day' END,
               CASE WHEN g.i <= 3 THEN v_t END
        FROM generate_series(1, 5) AS g(i)
        JOIN public.users u ON u.email = format('tester%s@demo.akoro.app', lpad((r.first_student + g.i - 1)::text, 2, '0'))
        ON CONFLICT (assignment_id, student_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;
