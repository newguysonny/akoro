-- =============================================================
-- 2026-seed-staff.sql
-- Seeds the demo school's Staff & Team directory with the common school
-- roles (Principal, Vice Principal, Teachers, Registrar, ...), filed into the
-- academic / non-academic groups used by the Staff & Team pages, with duty,
-- qualification, experience and graduation year filled in.
--
-- Idempotent: each staff is inserted only if that staff_no is absent for the
-- demo school. Run after 2026-staff-columns.sql. Demo data — not for prod.
-- =============================================================

DO $$
DECLARE
  v_school uuid;
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN RAISE NOTICE 'Demo school not found — skipping staff seed.'; RETURN; END IF;

  INSERT INTO mgmt.staff
    (school_id, staff_no, first_name, last_name, gender, staff_class, staff_group,
     duty, qualification, experience_years, year_of_graduation, status, joined_on)
  SELECT v_school, s.staff_no, s.first_name, s.last_name, s.gender, s.staff_class, s.staff_group,
         s.duty, s.qualification, s.experience_years, s.year_of_graduation, 'active', s.joined_on
  FROM (VALUES
    -- ── Academic ───────────────────────────────────────────────────────────
    ('STF-101','Chukwuemeka','Okafor','male','academic','Leadership',
       'Principal','B.Ed 1995, M.Ed Educational Mgmt 2004',28,1995,DATE '2015-09-01'),
    ('STF-102','Aisha','Mohammed','female','academic','Leadership',
       'Vice Principal (Academics)','B.Sc Mathematics 2001, PGDE 2003',21,2001,DATE '2016-01-11'),
    ('STF-103','Opeyemi','Bello','male','academic','Class Teacher',
       'Geography/SOS','BSc. Accounting 2012',11,2012,DATE '2018-09-03'),
    ('STF-104','Olufunmilayo','Juba','female','academic','Class Teacher',
       'English/Literature','NCE 1993, B.Ed 1998, M.A. Ed 2015',30,1998,DATE '2010-09-06'),
    ('STF-105','Fatima','Sanusi','female','academic','Academic Coordinators',
       'Examinations Coordinator','B.Sc Statistics 2006, PGDE 2009',17,2006,DATE '2014-09-01'),
    ('STF-106','Ngozi','Eze','female','academic','Special Needs Teacher',
       'Guidance Counselor','B.Sc Psychology 2008, M.Ed Guidance & Counselling 2013',15,2008,DATE '2015-01-12'),
    ('STF-107','Tunde','Adeyemi','male','academic','Teaching Assistants',
       'Science Lab Assistant','ND Science Lab Technology 2016',7,2016,DATE '2019-09-02'),
    -- ── Non-academic ───────────────────────────────────────────────────────
    ('STF-201','Emeka','Nwankwo','male','non_academic','Administration',
       'Registrar','B.Sc Public Administration 2005',18,2005,DATE '2013-08-19'),
    ('STF-202','Bola','Ogunleye','male','non_academic','Security',
       'Chief Security Officer','Security Management Cert. 2014 (Retired NPF)',25,2014,DATE '2016-02-01'),
    ('STF-203','Chioma','Okoro','female','non_academic','Front Desk & Reception',
       'Front Desk Officer','OND Business Administration 2015',8,2015,DATE '2018-09-10'),
    ('STF-204','Yusuf','Abdullahi','male','non_academic','Maintenance',
       'Facility Manager','HND Estate Management 2007',16,2007,DATE '2014-03-04'),
    ('STF-205','Grace','Adebayo','female','non_academic','Bursary & Accounts',
       'School Bursar','B.Sc Accounting 2004, ICAN 2010',19,2004,DATE '2012-05-02'),
    ('STF-206','Halima','Ibrahim','female','non_academic','Medical & Nursing',
       'School Nurse','RN/RM 2009, B.NSc 2016',14,2009,DATE '2017-09-01'),
    ('STF-207','Kelechi','Onyeka','female','non_academic','Marketing & Communications',
       'Digital Marketing Officer','B.Sc Mass Communication 2017',6,2017,DATE '2020-10-05'),
    ('STF-208','Comfort','Ekanem','female','non_academic','Boarding & Welfare',
       'Matron / Asst. House Parent','NCE Home Economics 2000',20,2000,DATE '2011-09-01'),
    ('STF-209','Samuel','Oyelaran','male','non_academic','Library',
       'Librarian','BLIS Library & Information Science 2010',13,2010,DATE '2015-09-01')
  ) AS s(staff_no, first_name, last_name, gender, staff_class, staff_group,
         duty, qualification, experience_years, year_of_graduation, joined_on)
  WHERE NOT EXISTS (
    SELECT 1 FROM mgmt.staff x WHERE x.school_id = v_school AND x.staff_no = s.staff_no
  );

  -- Re-file the three roles that now have their own group cards (safe if the
  -- rows were seeded earlier under 'Administration').
  UPDATE mgmt.staff SET staff_group = 'Marketing & Communications'
    WHERE school_id = v_school AND staff_no = 'STF-207';
  UPDATE mgmt.staff SET staff_group = 'Boarding & Welfare'
    WHERE school_id = v_school AND staff_no = 'STF-208';
  UPDATE mgmt.staff SET staff_group = 'Library'
    WHERE school_id = v_school AND staff_no = 'STF-209';
END $$;
