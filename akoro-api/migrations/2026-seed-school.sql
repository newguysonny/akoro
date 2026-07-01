-- =============================================================
-- 2026-seed-school.sql
-- Demo school for testing the akoro-school app:
--   1 school (admin: school@demo.akoro.app)
--   6 teachers (teacher1..6@demo.akoro.app)
--   6 classes: JSS1, JSS2, JSS3, SS1, SS2, SS3 (each assigned a teacher)
--   2 published courses (owned by teacher 1 & 2)
--   + 2 students per class (12) so classes aren't empty
--
-- All seeded accounts log in with password: Password123!
-- Idempotent — guarded by email/slug/name. Run once in Supabase SQL Editor.
-- =============================================================

DO $$
DECLARE
  pw        text := '$2b$10$HKzqNJTCBHeB0uWSWhf7PeLIOMrlEw2.9oYDI3vQPEs6WAl5Fo7KS'; -- Password123!
  admin_id  uuid;
  school_id uuid;
  tids      uuid[] := '{}';
  tid       uuid;
  cid       uuid;
  sid       uuid;
  i         int;
  j         int;
  tnames    text[] := ARRAY['Amara Diallo','Tobi Adeyemi','Ngozi Okafor','Chidi Balogun','Fatima Sani','Emeka Nwosu'];
  cnames    text[] := ARRAY['JSS1','JSS2','JSS3','SS1','SS2','SS3'];
BEGIN
  -- ── School admin ──────────────────────────────────────────
  SELECT id INTO admin_id FROM public.users WHERE email = 'school@demo.akoro.app';
  IF admin_id IS NULL THEN
    INSERT INTO public.users (email, username, password_hash, full_name, role, is_active)
    VALUES ('school@demo.akoro.app', 'demo_school_admin', pw, 'Demo School Admin', 'school_admin', true)
    RETURNING id INTO admin_id;
  END IF;

  -- ── School profile ────────────────────────────────────────
  SELECT id INTO school_id FROM public.school_profiles WHERE admin_user_id = admin_id LIMIT 1;
  IF school_id IS NULL THEN
    INSERT INTO public.school_profiles (admin_user_id, name, description, is_active)
    VALUES (admin_id, 'Akoro Demo Academy', 'A demo secondary school for testing the school portal.', true)
    RETURNING id INTO school_id;
  END IF;

  -- ── 6 teachers ────────────────────────────────────────────
  FOR i IN 1..6 LOOP
    SELECT id INTO tid FROM public.users WHERE email = 'teacher' || i || '@demo.akoro.app';
    IF tid IS NULL THEN
      INSERT INTO public.users (email, username, password_hash, full_name, role, is_active)
      VALUES ('teacher' || i || '@demo.akoro.app', 'demo_teacher' || i, pw, tnames[i], 'instructor', true)
      RETURNING id INTO tid;
    END IF;
    INSERT INTO public.school_teachers (school_id, teacher_id) VALUES (school_id, tid)
      ON CONFLICT (school_id, teacher_id) DO NOTHING;
    tids := array_append(tids, tid);
  END LOOP;

  -- ── 6 classes (JSS1..SS3), each with a teacher ────────────
  FOR i IN 1..6 LOOP
    IF NOT EXISTS (SELECT 1 FROM public.classrooms WHERE school_id = school_id AND name = cnames[i]) THEN
      INSERT INTO public.classrooms (school_id, teacher_id, name, description, student_limit, is_upgraded)
      VALUES (school_id, tids[i], cnames[i], cnames[i] || ' class', 9999, true);
    END IF;

    -- 2 students per class
    SELECT id INTO cid FROM public.classrooms WHERE school_id = school_id AND name = cnames[i];
    FOR j IN 1..2 LOOP
      SELECT id INTO sid FROM public.users WHERE email = 'stu.' || lower(cnames[i]) || j || '@demo.akoro.app';
      IF sid IS NULL THEN
        INSERT INTO public.users (email, username, password_hash, full_name, role, is_active)
        VALUES ('stu.' || lower(cnames[i]) || j || '@demo.akoro.app', 'demo_stu_' || lower(cnames[i]) || j, pw, 'Student ' || cnames[i] || '-' || j, 'student', true)
        RETURNING id INTO sid;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.classroom_students WHERE classroom_id = cid AND user_id = sid) THEN
        INSERT INTO public.classroom_students (classroom_id, user_id, status) VALUES (cid, sid, 'active');
      END IF;
    END LOOP;
  END LOOP;

  -- ── 2 published courses (teacher 1 & 2) ───────────────────
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE slug = 'demo-academy-maths') THEN
    INSERT INTO public.courses (instructor_id, title, slug, description, subject, level, language, price, is_free, course_type, is_published, published_at, total_hours, total_students, rating, created_at, updated_at)
    VALUES (tids[1], 'JSS Mathematics', 'demo-academy-maths', 'Core JSS mathematics for the demo academy.', 'Mathematics', 'beginner', 'English', 0, true, 'video', true, now(), 24, 0, 4.8, now(), now());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE slug = 'demo-academy-english') THEN
    INSERT INTO public.courses (instructor_id, title, slug, description, subject, level, language, price, is_free, course_type, is_published, published_at, total_hours, total_students, rating, created_at, updated_at)
    VALUES (tids[2], 'SS English Language', 'demo-academy-english', 'SS English language for the demo academy.', 'English Language', 'intermediate', 'English', 0, true, 'live', true, now(), 18, 0, 4.7, now(), now());
  END IF;
END $$;

-- Verify:
-- SELECT name FROM public.school_profiles WHERE name = 'Akoro Demo Academy';
-- SELECT name, teacher_id FROM public.classrooms c JOIN public.school_profiles s ON s.id=c.school_id WHERE s.name='Akoro Demo Academy';
