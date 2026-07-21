-- =============================================================
-- seed-demo-jss11.sql  —  fully set up a management class for a demo student
--
-- Links stu.jss11@demo.akoro.app to a JSS 11 class in the mgmt (SIS) module and
-- gives it subjects, a period grid, a full Mon–Fri timetable, a weekly scheme of
-- work, and TODAY's classwork logs — so the after-school Assessment picker has
-- real "today's subjects & activities" to offer.
--
-- Idempotent: safe to re-run. Run in the Supabase SQL editor (or psql).
-- Change the email below to seed a different student.
-- =============================================================
DO $$
DECLARE
  v_email  text := 'stu.jss11@demo.akoro.app';
  v_user   uuid;
  v_school uuid;
  v_class  uuid;
  v_sec    uuid;
  v_math uuid; v_eng uuid; v_bio uuid; v_phy uuid; v_chem uuid; v_geo uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid;
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

  -- 9. Link the student to the mgmt roster (idempotent by user_id).
  IF EXISTS (SELECT 1 FROM mgmt.students WHERE user_id = v_user) THEN
    UPDATE mgmt.students SET school_id=v_school, class_id=v_class, section_id=v_sec, status='active' WHERE user_id=v_user;
  ELSE
    INSERT INTO mgmt.students (school_id, admission_no, first_name, last_name, class_id, section_id, user_id, status)
    VALUES (v_school, 'JSS11-001', 'Demo', 'JSS11 Student', v_class, v_sec, v_user, 'active');
  END IF;

  RAISE NOTICE 'Seeded JSS 11 for % (school %, class %)', v_email, v_school, v_class;
END $$;
