-- =============================================================
-- 2026-seed-demo-jss11.sql  —  demo group (auto-runs on deploy)
--
-- Fully sets up a JSS 11 management class for the demo student
-- stu.jss11@demo.akoro.app: section A, subjects, a period grid, a full Mon–Fri
-- timetable, a weekly scheme of work, and TODAY's classwork logs — so the
-- after-school Assessment picker always has real "today's subjects & activities".
--
-- Also seeds a PARENT for the parent-concierge demo:
--   parent.jss11@demo.akoro.app  /  Parent2026   (guardian of the student)
-- plus sample termly fees (₦70,000 owed − ₦20,000 paid = ₦50,000 outstanding).
--
-- Runs last in the demo group (after the demo school + student are seeded).
-- Idempotent and fail-safe: skips quietly if the user/school isn't present, so
-- it's harmless in any environment. TODAY's classwork is rebuilt on each deploy
-- so the demo always shows current-day activities.
-- =============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $$
DECLARE
  v_email        text := 'stu.jss11@demo.akoro.app';
  v_parent_email text := 'parent.jss11@demo.akoro.app';   -- password: Parent2026
  v_user   uuid;
  v_parent uuid;
  v_stud   uuid;
  v_school uuid;
  v_class  uuid;
  v_sec    uuid;
  v_math uuid; v_eng uuid; v_bio uuid; v_phy uuid; v_chem uuid; v_geo uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid;
  v_fg uuid; v_ft_tui uuid; v_ft_pta uuid; v_ft_lunch uuid;
BEGIN
  -- 1. Resolve the user. Skip quietly if absent (safe to run anywhere).
  SELECT id INTO v_user FROM public.users WHERE lower(email) = lower(v_email);
  IF v_user IS NULL THEN RAISE NOTICE 'No user with email % — skipping.', v_email; RETURN; END IF;

  -- 2. Resolve the school from the student's classroom membership; else first school.
  SELECT c.school_id INTO v_school
  FROM public.classroom_students cs JOIN public.classrooms c ON c.id = cs.classroom_id
  WHERE cs.user_id = v_user AND c.school_id IS NOT NULL LIMIT 1;
  IF v_school IS NULL THEN SELECT id INTO v_school FROM public.school_profiles ORDER BY created_at LIMIT 1; END IF;
  IF v_school IS NULL THEN RAISE NOTICE 'No school found — skipping.'; RETURN; END IF;

  -- 3. Class + section.
  INSERT INTO mgmt.classes (school_id, name, sort_order) VALUES (v_school, 'JSS 11', 11)
    ON CONFLICT (school_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order RETURNING id INTO v_class;
  INSERT INTO mgmt.sections (school_id, class_id, name) VALUES (v_school, v_class, 'A')
    ON CONFLICT (class_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id INTO v_sec;

  -- 4. Subjects.
  INSERT INTO mgmt.subjects (school_id, name, code, subject_type) VALUES (v_school,'Mathematics','MTH','core')
    ON CONFLICT (school_id, name) DO UPDATE SET code=EXCLUDED.code RETURNING id INTO v_math;
  INSERT INTO mgmt.subjects (school_id, name, code, subject_type) VALUES (v_school,'English Language','ENG','core')
    ON CONFLICT (school_id, name) DO UPDATE SET code=EXCLUDED.code RETURNING id INTO v_eng;
  INSERT INTO mgmt.subjects (school_id, name, code, subject_type) VALUES (v_school,'Biology','BIO','core')
    ON CONFLICT (school_id, name) DO UPDATE SET code=EXCLUDED.code RETURNING id INTO v_bio;
  INSERT INTO mgmt.subjects (school_id, name, code, subject_type) VALUES (v_school,'Physics','PHY','core')
    ON CONFLICT (school_id, name) DO UPDATE SET code=EXCLUDED.code RETURNING id INTO v_phy;
  INSERT INTO mgmt.subjects (school_id, name, code, subject_type) VALUES (v_school,'Chemistry','CHM','core')
    ON CONFLICT (school_id, name) DO UPDATE SET code=EXCLUDED.code RETURNING id INTO v_chem;
  INSERT INTO mgmt.subjects (school_id, name, code, subject_type) VALUES (v_school,'Geography','GEO','elective')
    ON CONFLICT (school_id, name) DO UPDATE SET code=EXCLUDED.code RETURNING id INTO v_geo;

  -- 5. Periods (daily bells).
  INSERT INTO mgmt.periods (school_id, name, starts_at, ends_at, sort_order) VALUES (v_school,'Period 1','08:00','08:45',1)
    ON CONFLICT (school_id, name) DO UPDATE SET starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at RETURNING id INTO p1;
  INSERT INTO mgmt.periods (school_id, name, starts_at, ends_at, sort_order) VALUES (v_school,'Period 2','08:45','09:30',2)
    ON CONFLICT (school_id, name) DO UPDATE SET starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at RETURNING id INTO p2;
  INSERT INTO mgmt.periods (school_id, name, starts_at, ends_at, sort_order) VALUES (v_school,'Period 3','09:45','10:30',3)
    ON CONFLICT (school_id, name) DO UPDATE SET starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at RETURNING id INTO p3;
  INSERT INTO mgmt.periods (school_id, name, starts_at, ends_at, sort_order) VALUES (v_school,'Period 4','10:30','11:15',4)
    ON CONFLICT (school_id, name) DO UPDATE SET starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at RETURNING id INTO p4;
  INSERT INTO mgmt.periods (school_id, name, starts_at, ends_at, sort_order) VALUES (v_school,'Period 5','11:30','12:15',5)
    ON CONFLICT (school_id, name) DO UPDATE SET starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at RETURNING id INTO p5;

  -- 6. Weekly timetable (Mon=1 … Fri=5). Rebuild cleanly for this class.
  DELETE FROM mgmt.timetable_slots WHERE class_id = v_class;
  INSERT INTO mgmt.timetable_slots (school_id, class_id, section_id, day_of_week, period_id, subject_id) VALUES
    (v_school,v_class,v_sec,1,p1,v_math),(v_school,v_class,v_sec,1,p2,v_eng),(v_school,v_class,v_sec,1,p3,v_bio),(v_school,v_class,v_sec,1,p4,v_phy),(v_school,v_class,v_sec,1,p5,v_geo),
    (v_school,v_class,v_sec,2,p1,v_eng),(v_school,v_class,v_sec,2,p2,v_math),(v_school,v_class,v_sec,2,p3,v_chem),(v_school,v_class,v_sec,2,p4,v_bio),(v_school,v_class,v_sec,2,p5,v_phy),
    (v_school,v_class,v_sec,3,p1,v_math),(v_school,v_class,v_sec,3,p2,v_phy),(v_school,v_class,v_sec,3,p3,v_eng),(v_school,v_class,v_sec,3,p4,v_chem),(v_school,v_class,v_sec,3,p5,v_bio),
    (v_school,v_class,v_sec,4,p1,v_chem),(v_school,v_class,v_sec,4,p2,v_bio),(v_school,v_class,v_sec,4,p3,v_math),(v_school,v_class,v_sec,4,p4,v_eng),(v_school,v_class,v_sec,4,p5,v_geo),
    (v_school,v_class,v_sec,5,p1,v_phy),(v_school,v_class,v_sec,5,p2,v_chem),(v_school,v_class,v_sec,5,p3,v_geo),(v_school,v_class,v_sec,5,p4,v_math),(v_school,v_class,v_sec,5,p5,v_eng);

  -- 7. Weekly scheme of work (this week's topics per subject).
  DELETE FROM mgmt.syllabus_items WHERE class_id = v_class;
  INSERT INTO mgmt.syllabus_items (school_id, class_id, subject_id, term, topic, description, status) VALUES
    (v_school,v_class,v_math,'First Term','Number bases and modular arithmetic','Operations and conversion in bases 2–10; modulo arithmetic.','covered'),
    (v_school,v_class,v_eng, 'First Term','Comprehension and summary writing','Reading for meaning; summarising passages.','covered'),
    (v_school,v_class,v_bio, 'First Term','The cell and its structure','Plant vs animal cells; organelles and functions.','covered'),
    (v_school,v_class,v_phy, 'First Term','Measurement and units','Fundamental and derived quantities; instruments.','pending'),
    (v_school,v_class,v_chem,'First Term','Particulate nature of matter','States of matter; atoms, molecules and ions.','pending');

  -- 8. TODAY's classwork logs (what was taught today → the assessment options).
  DELETE FROM mgmt.classwork_logs WHERE class_id = v_class AND log_date = CURRENT_DATE;
  INSERT INTO mgmt.classwork_logs (school_id, class_id, subject_id, log_date, topic, notes) VALUES
    (v_school,v_class,v_math,CURRENT_DATE,'Number bases and modular arithmetic','Converted between bases 2–10 and solved modulo problems.'),
    (v_school,v_class,v_eng, CURRENT_DATE,'Comprehension and summary writing','Read a passage and wrote a one-paragraph summary.'),
    (v_school,v_class,v_bio, CURRENT_DATE,'The cell and its structure','Labelled plant and animal cells; discussed organelle functions.');

  -- 9. Parent account (login: parent.jss11@demo.akoro.app / Parent2026).
  INSERT INTO public.users (email, username, password_hash, full_name, role, is_active)
  VALUES (v_parent_email, 'parent_jss11',
          extensions.crypt('Parent2026', extensions.gen_salt('bf')), 'Demo Parent', 'student', true)
  ON CONFLICT (email) DO UPDATE
    SET password_hash = extensions.crypt('Parent2026', extensions.gen_salt('bf')), is_active = true
  RETURNING id INTO v_parent;

  -- 10. Link the student to the mgmt roster + set the guardian to the parent.
  IF EXISTS (SELECT 1 FROM mgmt.students WHERE user_id = v_user) THEN
    UPDATE mgmt.students SET school_id=v_school, class_id=v_class, section_id=v_sec, status='active',
           guardian_name='Demo Parent', guardian_email=v_parent_email
      WHERE user_id=v_user RETURNING id INTO v_stud;
  ELSE
    INSERT INTO mgmt.students (school_id, admission_no, first_name, last_name, class_id, section_id, user_id, status, guardian_name, guardian_email)
    VALUES (v_school, 'JSS11-001', 'Demo', 'JSS11 Student', v_class, v_sec, v_user, 'active', 'Demo Parent', v_parent_email)
    RETURNING id INTO v_stud;
  END IF;

  -- 11. Sample fees → outstanding balance (owed 70,000 − paid 20,000 = 50,000).
  INSERT INTO mgmt.fee_groups (school_id, name, description) VALUES (v_school,'School Fees','Termly fees')
    ON CONFLICT (school_id, name) DO UPDATE SET description=EXCLUDED.description RETURNING id INTO v_fg;
  INSERT INTO mgmt.fee_types (school_id, group_id, name, code, default_amount) VALUES (v_school,v_fg,'Tuition (First Term)','TUI',50000)
    ON CONFLICT (school_id, name) DO UPDATE SET default_amount=EXCLUDED.default_amount RETURNING id INTO v_ft_tui;
  INSERT INTO mgmt.fee_types (school_id, group_id, name, code, default_amount) VALUES (v_school,v_fg,'PTA Levy','PTA',5000)
    ON CONFLICT (school_id, name) DO UPDATE SET default_amount=EXCLUDED.default_amount RETURNING id INTO v_ft_pta;
  INSERT INTO mgmt.fee_types (school_id, group_id, name, code, default_amount) VALUES (v_school,v_fg,'Lunch (Term)','LUN',15000)
    ON CONFLICT (school_id, name) DO UPDATE SET default_amount=EXCLUDED.default_amount RETURNING id INTO v_ft_lunch;

  -- Rebuild this class/student's assignments + the demo payment cleanly.
  DELETE FROM mgmt.fee_assignments WHERE school_id=v_school AND (class_id=v_class OR student_id=v_stud);
  INSERT INTO mgmt.fee_assignments (school_id, fee_type_id, class_id, amount, due_date) VALUES
    (v_school, v_ft_tui,   v_class, 50000, CURRENT_DATE + 14),
    (v_school, v_ft_pta,   v_class,  5000, CURRENT_DATE + 14),
    (v_school, v_ft_lunch, v_class, 15000, CURRENT_DATE + 14);
  DELETE FROM mgmt.fee_payments WHERE student_id=v_stud AND note='demo-seed';
  INSERT INTO mgmt.fee_payments (school_id, student_id, amount, method, reference, note, paid_on)
    VALUES (v_school, v_stud, 20000, 'online', 'DEMO-PART-PAY', 'demo-seed', CURRENT_DATE);

  RAISE NOTICE 'Seeded JSS 11 + parent % for % (school %)', v_parent_email, v_email, v_school;
END $$;
