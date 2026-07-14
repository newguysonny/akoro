-- =============================================================
-- 2026-seed-school-passwords.sql   (DEMO group — opt-in)
-- Give Akoro Demo Academy's members real first names + known passwords so the
-- website AI-chat login can be tested. Password = <FirstName>2026 (e.g.
-- Priya2026), hashed with pgcrypto's bcrypt (verified by the Node bcrypt at
-- login). Only the demo school's own members are touched. Idempotent.
--
--   Admin   : school@demo.akoro.app                 → Admin2026
--   Teachers: teacher1..6@demo.akoro.app            → <FirstName>2026
--   Students: stu.<class><n>@demo.akoro.app         → <FirstName>2026
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$
DECLARE
  v_school uuid;
  v_names  text[] := ARRAY['Priya','Amara','Chidi','Amina','Tunde','Ngozi','Emeka','Zainab','Bola','Kunle','Fatima','David'];
  r        record;
  i        int := 0;
BEGIN
  SELECT sp.id INTO v_school
  FROM public.school_profiles sp
  JOIN public.users u ON u.id = sp.admin_user_id
  WHERE u.email = 'school@demo.akoro.app'
  LIMIT 1;
  IF v_school IS NULL THEN RETURN; END IF;

  -- Admin
  UPDATE public.users
     SET password_hash = extensions.crypt('Admin2026', extensions.gen_salt('bf'))
   WHERE id = (SELECT admin_user_id FROM public.school_profiles WHERE id = v_school);

  -- Teachers → FirstName2026 from their existing full name
  UPDATE public.users u
     SET password_hash = extensions.crypt(initcap(split_part(u.full_name, ' ', 1)) || '2026', extensions.gen_salt('bf'))
    FROM public.school_teachers st
   WHERE st.school_id = v_school AND st.teacher_id = u.id;

  -- Students → assign a real first name (keep their class suffix) + FirstName2026
  FOR r IN
    SELECT DISTINCT u.id, u.full_name
    FROM public.users u
    JOIN public.classroom_students cs ON cs.user_id = u.id
    JOIN public.classrooms c          ON c.id = cs.classroom_id
    WHERE c.school_id = v_school AND u.role = 'student'
    ORDER BY u.id
  LOOP
    i := i + 1;
    UPDATE public.users
       SET full_name     = v_names[((i - 1) % array_length(v_names, 1)) + 1] || ' ' || COALESCE(NULLIF(split_part(full_name, ' ', 2), ''), 'Student'),
           password_hash = extensions.crypt(v_names[((i - 1) % array_length(v_names, 1)) + 1] || '2026', extensions.gen_salt('bf'))
     WHERE id = r.id;
  END LOOP;
END $$;

-- Verify:
-- SELECT u.email, u.full_name FROM public.users u
--   JOIN public.classroom_students cs ON cs.user_id=u.id
--   JOIN public.classrooms c ON c.id=cs.classroom_id
--   JOIN public.school_profiles sp ON sp.id=c.school_id
--   JOIN public.users a ON a.id=sp.admin_user_id
--  WHERE a.email='school@demo.akoro.app';
