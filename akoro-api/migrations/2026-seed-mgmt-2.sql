-- =============================================================
-- 2026-seed-mgmt-2.sql
-- Demo data for the second mgmt batch (Accounts, HR, Exams, CBC, PTM, …).
-- Run AFTER 2026-mgmt-schema-2.sql. Idempotent.
-- =============================================================

DO $$
DECLARE
  v_school uuid; v_dep uuid; v_des uuid; v_head uuid; v_type uuid; v_exam uuid; v_sess uuid;
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN RAISE NOTICE 'Demo school not found — skipping.'; RETURN; END IF;
  SELECT id INTO v_sess FROM mgmt.academic_sessions WHERE school_id = v_school AND is_active LIMIT 1;

  -- Accounts
  INSERT INTO mgmt.income_heads (school_id, name)
  SELECT v_school, h FROM unnest(ARRAY['School Fees','Donations','Hall Rental']) h
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.income_heads WHERE school_id = v_school AND name = h);
  INSERT INTO mgmt.expense_heads (school_id, name)
  SELECT v_school, h FROM unnest(ARRAY['Salaries','Utilities','Maintenance']) h
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.expense_heads WHERE school_id = v_school AND name = h);
  IF NOT EXISTS (SELECT 1 FROM mgmt.incomes WHERE school_id = v_school) THEN
    SELECT id INTO v_head FROM mgmt.income_heads WHERE school_id = v_school AND name = 'Donations';
    INSERT INTO mgmt.incomes (school_id, head_id, amount, source, received_on)
    VALUES (v_school, v_head, 150000, 'PTA end-of-year donation', CURRENT_DATE - 10);
    SELECT id INTO v_head FROM mgmt.expense_heads WHERE school_id = v_school AND name = 'Utilities';
    INSERT INTO mgmt.expenses (school_id, head_id, amount, paid_to, spent_on)
    VALUES (v_school, v_head, 48000, 'PHCN — electricity', CURRENT_DATE - 5);
  END IF;
  INSERT INTO mgmt.bank_accounts (school_id, name, bank_name, account_no, balance)
  SELECT v_school, 'Main Operations', 'GTBank', '0123456789', 2450000
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.bank_accounts WHERE school_id = v_school);

  -- HR
  INSERT INTO mgmt.departments (school_id, name)
  SELECT v_school, d FROM unnest(ARRAY['Academics','Administration']) d
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.departments WHERE school_id = v_school AND name = d);
  INSERT INTO mgmt.designations (school_id, name)
  SELECT v_school, d FROM unnest(ARRAY['Teacher','Bursar','Registrar']) d
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.designations WHERE school_id = v_school AND name = d);
  IF NOT EXISTS (SELECT 1 FROM mgmt.staff WHERE school_id = v_school) THEN
    SELECT id INTO v_dep FROM mgmt.departments WHERE school_id = v_school AND name = 'Academics';
    SELECT id INTO v_des FROM mgmt.designations WHERE school_id = v_school AND name = 'Teacher';
    INSERT INTO mgmt.staff (school_id, staff_no, first_name, last_name, gender, phone, department_id, designation_id, monthly_salary, joined_on) VALUES
      (v_school, 'STF-001', 'Adaeze', 'Nwosu', 'female', '+2348051112222', v_dep, v_des, 120000, '2024-09-01'),
      (v_school, 'STF-002', 'Ibrahim', 'Suleiman', 'male', '+2348063334444', v_dep, v_des, 110000, '2025-01-15');
    SELECT id INTO v_dep FROM mgmt.departments WHERE school_id = v_school AND name = 'Administration';
    SELECT id INTO v_des FROM mgmt.designations WHERE school_id = v_school AND name = 'Bursar';
    INSERT INTO mgmt.staff (school_id, staff_no, first_name, last_name, gender, phone, department_id, designation_id, monthly_salary, joined_on)
    VALUES (v_school, 'STF-003', 'Grace', 'Okon', 'female', '+2348075556666', v_dep, v_des, 95000, '2023-05-02');
  END IF;
  INSERT INTO mgmt.leave_types (school_id, name, days_allowed)
  SELECT v_school, t.n, t.d FROM (VALUES ('Annual Leave', 21), ('Sick Leave', 10), ('Casual Leave', 5)) t(n, d)
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.leave_types WHERE school_id = v_school AND name = t.n);

  -- Exams
  INSERT INTO mgmt.exam_types (school_id, name)
  SELECT v_school, t FROM unnest(ARRAY['Mid-Term','End of Term']) t
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.exam_types WHERE school_id = v_school AND name = t);
  IF NOT EXISTS (SELECT 1 FROM mgmt.exams WHERE school_id = v_school) THEN
    SELECT id INTO v_type FROM mgmt.exam_types WHERE school_id = v_school AND name = 'Mid-Term';
    INSERT INTO mgmt.exams (school_id, name, exam_type_id, session_id, starts_on, ends_on, status)
    VALUES (v_school, 'First Term Mid-Term 2026', v_type, v_sess, CURRENT_DATE + 14, CURRENT_DATE + 18, 'upcoming')
    RETURNING id INTO v_exam;
  END IF;
  INSERT INTO mgmt.grade_scales (school_id, grade, min_percent, max_percent, remark)
  SELECT v_school, g.g, g.mn, g.mx, g.r FROM (VALUES
    ('A', 70, 100, 'Excellent'), ('B', 60, 69, 'Very Good'), ('C', 50, 59, 'Good'),
    ('D', 40, 49, 'Pass'), ('F', 0, 39, 'Fail')) g(g, mn, mx, r)
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.grade_scales WHERE school_id = v_school);
  INSERT INTO mgmt.cocurricular_areas (school_id, name)
  SELECT v_school, a FROM unnest(ARRAY['Sports','Music','Debate Club']) a
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.cocurricular_areas WHERE school_id = v_school AND name = a);

  -- CBC
  INSERT INTO mgmt.core_competencies (school_id, name, description)
  SELECT v_school, c.n, c.d FROM (VALUES
    ('Communication & Collaboration', 'Expressing ideas clearly and working with others.'),
    ('Critical Thinking', 'Analysing information and solving problems.')) c(n, d)
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.core_competencies WHERE school_id = v_school AND name = c.n);

  RAISE NOTICE 'Seeded mgmt batch 2 for school_id=%', v_school;
END $$;
