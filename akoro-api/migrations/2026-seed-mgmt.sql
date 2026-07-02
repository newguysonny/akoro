-- =============================================================
-- 2026-seed-mgmt.sql
-- Demo data for the mgmt schema (Management + Facilities modules), applied
-- to 'Akoro Demo Academy'. Run AFTER 2026-mgmt-schema.sql.
-- Idempotent — guarded by NOT EXISTS checks. Safe to re-run.
-- =============================================================

DO $$
DECLARE
  v_school uuid;
  v_session uuid;
  v_class uuid;
  v_sec uuid;
  v_cat_day uuid; v_cat_board uuid;
  v_house uuid;
  v_grp uuid;
  v_ft_tuition uuid; v_ft_exam uuid; v_ft_pta uuid;
  v_student uuid;
  v_cname text;
  v_i integer := 0;
  v_names text[] := ARRAY['JSS1','JSS2','JSS3','SS1','SS2','SS3'];
  v_first text[] := ARRAY['Chidi','Amina','Tunde','Ngozi','Emeka','Zainab'];
  v_last  text[] := ARRAY['Okafor','Bello','Adeyemi','Eze','Obi','Yusuf'];
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN
    RAISE NOTICE 'Demo school not found — run 2026-seed-school.sql first. Skipping.';
    RETURN;
  END IF;

  -- ── Academic session ─────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM mgmt.academic_sessions WHERE school_id = v_school) THEN
    INSERT INTO mgmt.academic_sessions (school_id, name, starts_on, ends_on, is_active)
    VALUES (v_school, '2026/2027', '2026-09-01', '2027-07-31', true);
  END IF;
  SELECT id INTO v_session FROM mgmt.academic_sessions WHERE school_id = v_school AND is_active LIMIT 1;

  -- ── Classes JSS1–SS3 with sections A & B ─────────────────────────
  FOREACH v_cname IN ARRAY v_names LOOP
    v_i := v_i + 1;
    IF NOT EXISTS (SELECT 1 FROM mgmt.classes WHERE school_id = v_school AND name = v_cname) THEN
      INSERT INTO mgmt.classes (school_id, name, sort_order) VALUES (v_school, v_cname, v_i);
    END IF;
    SELECT id INTO v_class FROM mgmt.classes WHERE school_id = v_school AND name = v_cname;
    INSERT INTO mgmt.sections (school_id, class_id, name)
    SELECT v_school, v_class, s FROM unnest(ARRAY['A','B']) AS s
    WHERE NOT EXISTS (SELECT 1 FROM mgmt.sections WHERE class_id = v_class AND name = s);
  END LOOP;

  -- ── Subjects ─────────────────────────────────────────────────────
  INSERT INTO mgmt.subjects (school_id, name, code, subject_type)
  SELECT v_school, s.n, s.c, s.t FROM (VALUES
    ('Mathematics','MTH','core'), ('English Language','ENG','core'),
    ('Basic Science','BSC','core'), ('Civic Education','CIV','core'),
    ('French','FRE','elective'), ('Computer Studies','CMP','elective')
  ) AS s(n,c,t)
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.subjects WHERE school_id = v_school AND name = s.n);

  -- ── Periods ──────────────────────────────────────────────────────
  INSERT INTO mgmt.periods (school_id, name, starts_at, ends_at, sort_order)
  SELECT v_school, p.n, p.s::time, p.e::time, p.o FROM (VALUES
    ('1st Period','08:00','08:45',1), ('2nd Period','08:45','09:30',2),
    ('3rd Period','09:30','10:15',3), ('4th Period','10:45','11:30',4),
    ('5th Period','11:30','12:15',5), ('6th Period','12:15','13:00',6)
  ) AS p(n,s,e,o)
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.periods WHERE school_id = v_school AND name = p.n);

  -- ── Categories & Houses ──────────────────────────────────────────
  INSERT INTO mgmt.student_categories (school_id, name)
  SELECT v_school, c FROM unnest(ARRAY['Day Student','Boarding Student']) AS c
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.student_categories WHERE school_id = v_school AND name = c);

  INSERT INTO mgmt.student_houses (school_id, name, color)
  SELECT v_school, h.n, h.c FROM (VALUES
    ('Red House','#EF4444'), ('Blue House','#3B82F6'),
    ('Green House','#10B981'), ('Yellow House','#F59E0B')
  ) AS h(n,c)
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.student_houses WHERE school_id = v_school AND name = h.n);

  SELECT id INTO v_cat_day   FROM mgmt.student_categories WHERE school_id = v_school AND name = 'Day Student';
  SELECT id INTO v_cat_board FROM mgmt.student_categories WHERE school_id = v_school AND name = 'Boarding Student';

  -- ── Students (one per class) ─────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM mgmt.students WHERE school_id = v_school) THEN
    FOR v_i IN 1..6 LOOP
      SELECT id INTO v_class FROM mgmt.classes WHERE school_id = v_school AND name = v_names[v_i];
      SELECT id INTO v_sec   FROM mgmt.sections WHERE class_id = v_class AND name = 'A';
      SELECT id INTO v_house FROM mgmt.student_houses WHERE school_id = v_school ORDER BY name LIMIT 1 OFFSET ((v_i - 1) % 4);
      INSERT INTO mgmt.students (school_id, admission_no, roll_no, first_name, last_name, gender, class_id, section_id,
                                 category_id, house_id, guardian_name, guardian_phone, status)
      VALUES (v_school, 'ADA-2026-' || lpad(v_i::text, 4, '0'), v_i::text, v_first[v_i], v_last[v_i],
              CASE WHEN v_i % 2 = 0 THEN 'female' ELSE 'male' END, v_class, v_sec,
              CASE WHEN v_i % 2 = 0 THEN v_cat_board ELSE v_cat_day END, v_house,
              'Mr/Mrs ' || v_last[v_i], '+2348030000' || lpad(v_i::text, 3, '0'), 'active');
    END LOOP;
  END IF;

  -- ── Fees: group, types, assignment for JSS1, one payment ─────────
  IF NOT EXISTS (SELECT 1 FROM mgmt.fee_groups WHERE school_id = v_school) THEN
    INSERT INTO mgmt.fee_groups (school_id, name, description)
    VALUES (v_school, 'Termly Fees', 'Standard per-term charges') RETURNING id INTO v_grp;
    INSERT INTO mgmt.fee_types (school_id, group_id, name, code, default_amount) VALUES
      (v_school, v_grp, 'Tuition Fee', 'TUI', 45000),
      (v_school, v_grp, 'Examination Fee', 'EXM', 5000),
      (v_school, v_grp, 'PTA Levy', 'PTA', 2000);
  END IF;
  SELECT id INTO v_ft_tuition FROM mgmt.fee_types WHERE school_id = v_school AND name = 'Tuition Fee';
  SELECT id INTO v_class FROM mgmt.classes WHERE school_id = v_school AND name = 'JSS1';

  IF v_ft_tuition IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mgmt.fee_assignments WHERE school_id = v_school) THEN
    INSERT INTO mgmt.fee_assignments (school_id, session_id, fee_type_id, class_id, amount, due_date)
    VALUES (v_school, v_session, v_ft_tuition, v_class, 45000, CURRENT_DATE + 30);
  END IF;

  SELECT id INTO v_student FROM mgmt.students WHERE school_id = v_school AND class_id = v_class LIMIT 1;
  IF v_student IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mgmt.fee_payments WHERE school_id = v_school) THEN
    INSERT INTO mgmt.fee_payments (school_id, student_id, amount, method, reference, paid_on, received_by)
    VALUES (v_school, v_student, 20000, 'cash', 'RCPT-0001', CURRENT_DATE - 3, 'Bursar');
  END IF;

  -- ── Front office samples ─────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM mgmt.enquiries WHERE school_id = v_school) THEN
    INSERT INTO mgmt.enquiries (school_id, name, phone, class_interest, source, status, note, follow_up_on)
    VALUES (v_school, 'Mrs. Funke Alabi', '+2348011122233', 'JSS1', 'Referral', 'new', 'Asked about boarding options.', CURRENT_DATE + 3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM mgmt.visitors WHERE school_id = v_school) THEN
    INSERT INTO mgmt.visitors (school_id, name, phone, purpose, to_meet, check_in)
    VALUES (v_school, 'Engr. Musa Ibrahim', '+2348099887766', 'Generator maintenance', 'Facilities Manager', now() - interval '2 hours');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM mgmt.complaints WHERE school_id = v_school) THEN
    INSERT INTO mgmt.complaints (school_id, complainant, phone, category, description, status)
    VALUES (v_school, 'Parent — Mr. Eze', '+2348022334455', 'Transport', 'Bus arrived late twice this week.', 'open');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM mgmt.postal_records WHERE school_id = v_school) THEN
    INSERT INTO mgmt.postal_records (school_id, direction, reference_no, from_name, to_name, item)
    VALUES (v_school, 'receive', 'PST-001', 'WAEC Office', 'Exams Officer', 'Examination registration documents');
  END IF;

  RAISE NOTICE 'Seeded mgmt data for school_id=%', v_school;
END $$;
