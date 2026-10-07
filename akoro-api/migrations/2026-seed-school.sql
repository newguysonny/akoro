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
-- (Local variables are v_-prefixed to avoid PL/pgSQL column ambiguity.)
-- =============================================================

DO $$
DECLARE
  v_pw      text := '$2b$10$HKzqNJTCBHeB0uWSWhf7PeLIOMrlEw2.9oYDI3vQPEs6WAl5Fo7KS'; -- Password123!
  v_admin   uuid;
  v_school  uuid;
  v_tids    uuid[] := '{}';
  v_tid     uuid;
  v_cid     uuid;
  v_sid     uuid;
  i         int;
  j         int;
  v_tnames  text[] := ARRAY['Amara Diallo','Tobi Adeyemi','Ngozi Okafor','Chidi Balogun','Fatima Sani','Emeka Nwosu'];
  v_cnames  text[] := ARRAY['JSS1','JSS2','JSS3','SS1','SS2','SS3'];
BEGIN
  -- ── School admin ──────────────────────────────────────────
  SELECT id INTO v_admin FROM public.users WHERE email = 'school@demo.akoro.app';
  IF v_admin IS NULL THEN
    INSERT INTO public.users (email, username, password_hash, full_name, role, is_active)
    VALUES ('school@demo.akoro.app', 'demo_school_admin', v_pw, 'Demo School Admin', 'school_admin', true)
    RETURNING id INTO v_admin;
  END IF;

  -- ── School profile ────────────────────────────────────────
  SELECT id INTO v_school FROM public.school_profiles WHERE admin_user_id = v_admin LIMIT 1;
  IF v_school IS NULL THEN
    INSERT INTO public.school_profiles (admin_user_id, name, description, is_active)
    VALUES (v_admin, 'Akoro Demo Academy', 'A demo secondary school for testing the school portal.', true)
    RETURNING id INTO v_school;
  END IF;

  -- ── 6 teachers ────────────────────────────────────────────
  FOR i IN 1..6 LOOP
    SELECT id INTO v_tid FROM public.users WHERE email = 'teacher' || i || '@demo.akoro.app';
    IF v_tid IS NULL THEN
      INSERT INTO public.users (email, username, password_hash, full_name, role, is_active)
      VALUES ('teacher' || i || '@demo.akoro.app', 'demo_teacher' || i, v_pw, v_tnames[i], 'instructor', true)
      RETURNING id INTO v_tid;
    END IF;
    INSERT INTO public.school_teachers (school_id, teacher_id) VALUES (v_school, v_tid)
      ON CONFLICT (school_id, teacher_id) DO NOTHING;
    v_tids := array_append(v_tids, v_tid);
  END LOOP;

  -- ── 6 classes (JSS1..SS3), each with a teacher + 2 students ─
  FOR i IN 1..6 LOOP
    IF NOT EXISTS (SELECT 1 FROM public.classrooms WHERE school_id = v_school AND name = v_cnames[i]) THEN
      INSERT INTO public.classrooms (school_id, teacher_id, name, description, student_limit, is_upgraded)
      VALUES (v_school, v_tids[i], v_cnames[i], v_cnames[i] || ' class', 9999, true);
    END IF;

    SELECT id INTO v_cid FROM public.classrooms WHERE school_id = v_school AND name = v_cnames[i];
    FOR j IN 1..2 LOOP
      SELECT id INTO v_sid FROM public.users WHERE email = 'stu.' || lower(v_cnames[i]) || j || '@demo.akoro.app';
      IF v_sid IS NULL THEN
        INSERT INTO public.users (email, username, password_hash, full_name, role, is_active)
        VALUES ('stu.' || lower(v_cnames[i]) || j || '@demo.akoro.app', 'demo_stu_' || lower(v_cnames[i]) || j, v_pw, 'Student ' || v_cnames[i] || '-' || j, 'student', true)
        RETURNING id INTO v_sid;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.classroom_students WHERE classroom_id = v_cid AND user_id = v_sid) THEN
        INSERT INTO public.classroom_students (classroom_id, user_id, status) VALUES (v_cid, v_sid, 'active');
      END IF;
    END LOOP;
  END LOOP;

  -- ── 2 published courses (teacher 1 & 2) ───────────────────
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE slug = 'demo-academy-maths') THEN
    INSERT INTO public.courses (instructor_id, title, slug, description, subject, level, language, price, is_free, course_type, is_published, published_at, total_hours, total_students, rating, created_at, updated_at)
    VALUES (v_tids[1], 'JSS Mathematics', 'demo-academy-maths', 'Core JSS mathematics for the demo academy.', 'Mathematics', 'beginner', 'English', 0, true, 'video', true, now(), 24, 0, 4.8, now(), now());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.courses WHERE slug = 'demo-academy-english') THEN
    INSERT INTO public.courses (instructor_id, title, slug, description, subject, level, language, price, is_free, course_type, is_published, published_at, total_hours, total_students, rating, created_at, updated_at)
    VALUES (v_tids[2], 'SS English Language', 'demo-academy-english', 'SS English language for the demo academy.', 'English Language', 'intermediate', 'English', 0, true, 'live', true, now(), 18, 0, 4.7, now(), now());
  END IF;
END $$;

-- Verify:
-- SELECT name FROM public.school_profiles WHERE name = 'Akoro Demo Academy';
-- SELECT c.name, u.full_name AS teacher FROM public.classrooms c
--   JOIN public.school_profiles s ON s.id = c.school_id
--   LEFT JOIN public.users u ON u.id = c.teacher_id
--   WHERE s.name = 'Akoro Demo Academy' ORDER BY c.name;
