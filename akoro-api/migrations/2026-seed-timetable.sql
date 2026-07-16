-- =============================================================
-- 2026-seed-timetable.sql  (demo group)
-- Seeds a full printed-style class timetable for Akoro Demo Academy:
--   • 14 school-wide periods with types (assembly / teaching / break /
--     lunch / activity) and time ranges matching the reference layout.
--   • Per-class timetable_slots for Mon–Fri, junior (JSS) and senior (SS)
--     variants, including "A or B" optional-subject cells.
--   • timetable_meta (approved + prepared/approved by) per class.
-- Idempotent: guarded per class; safe to re-run. Demo data only.
-- =============================================================

DO $$
DECLARE
  v_school  uuid;
  v_class   record;
  v_pid     uuid[];                          -- period id by sort_order (1..14)
  teach     int[] := ARRAY[2,3,5,6,8,10,11,12,13];  -- teaching cols → period sort
  g         record;
  v_subj    uuid;
  v_alt     uuid;
  v_junior  boolean;
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN RAISE NOTICE 'Demo school not found — skipping timetable seed.'; RETURN; END IF;

  -- ── Subjects (codes are what the grid displays) ────────────────────────
  INSERT INTO mgmt.subjects (school_id, name, code, subject_type)
  SELECT v_school, s.n, s.c, s.t FROM (VALUES
    ('English','ENG','core'), ('Social Studies','SST','core'),
    ('Mathematics','MATHS','core'), ('Business Studies','BST','core'),
    ('Kiswahili','KISW','core'), ('Religious Education','REL.E','core'),
    ('Visual Arts','V.Arts','elective'), ('Performing Arts','P.Arts','elective'),
    ('Pre-Technical Studies','PRE-TECH','core'), ('Physical Education & Sports','P.E&S','core'),
    ('Agriculture','AGRIC','core'), ('Integrated Science','INT/SCI','core'),
    ('Health Education','H.E','core'), ('Home Science','H.SCIE','elective'),
    ('Computer Science','COMP SCIE','elective'), ('Life Skills','L/SKILL','core'),
    ('Biology','BIO','core'), ('Chemistry','CHE','core'), ('Physics','PHY','core'),
    ('Economics','ECON','core'), ('Geography','GEO','core'), ('Literature','LIT','core')
  ) AS s(n,c,t)
  WHERE NOT EXISTS (SELECT 1 FROM mgmt.subjects WHERE school_id = v_school AND code = s.c);

  -- ── 14 school-wide periods (recreate cleanly) ──────────────────────────
  -- Remove the old plain demo periods and any prior timetable periods so the
  -- structure is exactly the reference (guard makes the whole block re-runnable).
  IF NOT EXISTS (SELECT 1 FROM mgmt.periods WHERE school_id = v_school AND name = 'Assembly') THEN
    DELETE FROM mgmt.periods WHERE school_id = v_school
      AND name IN ('1st Period','2nd Period','3rd Period','4th Period','5th Period','6th Period');

    INSERT INTO mgmt.periods (school_id, name, starts_at, ends_at, sort_order, type) VALUES
      (v_school, 'Assembly',  '07:00','08:20', 1,  'assembly'),
      (v_school, 'P1',        '08:20','09:00', 2,  'teaching'),
      (v_school, 'P2',        '09:00','09:40', 3,  'teaching'),
      (v_school, 'Break 1',   '09:40','10:00', 4,  'break'),
      (v_school, 'P3',        '10:00','10:40', 5,  'teaching'),
      (v_school, 'P4',        '10:40','11:20', 6,  'teaching'),
      (v_school, 'Break 2',   '11:20','11:35', 7,  'break'),
      (v_school, 'P5',        '11:35','12:05', 8,  'teaching'),
      (v_school, 'Lunch',     '12:05','12:55', 9,  'lunch'),
      (v_school, 'P6',        '12:55','14:00', 10, 'teaching'),
      (v_school, 'P7',        '14:00','14:40', 11, 'teaching'),
      (v_school, 'P8',        '14:40','15:20', 12, 'teaching'),
      (v_school, 'P9',        '15:20','16:00', 13, 'teaching'),
      (v_school, 'Activity',  '16:00','17:00', 14, 'activity');
  END IF;

  -- period id by sort_order
  v_pid := ARRAY(SELECT id FROM mgmt.periods WHERE school_id = v_school AND sort_order BETWEEN 1 AND 14 ORDER BY sort_order);

  -- ── Per class: build the grid ──────────────────────────────────────────
  FOR v_class IN SELECT id, name FROM mgmt.classes WHERE school_id = v_school LOOP
    -- skip if this class already has a timetable
    CONTINUE WHEN EXISTS (SELECT 1 FROM mgmt.timetable_slots WHERE class_id = v_class.id);
    v_junior := v_class.name LIKE 'JSS%';

    FOR g IN
      SELECT day, col, code, alt FROM (
        SELECT * FROM (VALUES
          -- JUNIOR (matches the reference Grade-7 timetable)
          (1,1,'ENG',NULL),(1,2,'SST',NULL),(1,3,'MATHS',NULL),(1,4,'BST',NULL),(1,5,'KISW',NULL),(1,6,'REL.E',NULL),(1,7,'V.Arts','P.Arts'),(1,8,'PRE-TECH',NULL),(1,9,'PRE-TECH',NULL),
          (2,1,'REL.E',NULL),(2,2,'MATHS',NULL),(2,3,'KISW',NULL),(2,4,'P.E&S',NULL),(2,5,'AGRIC',NULL),(2,6,'AGRIC',NULL),(2,7,'ENG',NULL),(2,8,'BST',NULL),(2,9,'H.SCIE','COMP SCIE'),
          (3,1,'KISW',NULL),(3,2,'MATHS',NULL),(3,3,'INT/SCI',NULL),(3,4,'INT/SCI',NULL),(3,5,'ENG',NULL),(3,6,'SST',NULL),(3,7,'H.E',NULL),(3,8,'H.SCIE','COMP SCIE'),(3,9,'V.Arts','P.Arts'),
          (4,1,'MATHS',NULL),(4,2,'H.E',NULL),(4,3,'BST',NULL),(4,4,'ENG',NULL),(4,5,'KISW',NULL),(4,6,'P.E&S',NULL),(4,7,'PRE-TECH',NULL),(4,8,'PRE-TECH',NULL),(4,9,'H.SCIE','COMP SCIE'),
          (5,1,'ENG',NULL),(5,2,'L/SKILL',NULL),(5,3,'MATHS',NULL),(5,4,'SST',NULL),(5,5,'INT/SCI',NULL),(5,6,'INT/SCI',NULL),(5,7,'REL.E',NULL),(5,8,'V.Arts','P.Arts'),(5,9,'AGRIC',NULL)
        ) AS j(day,col,code,alt) WHERE v_junior
        UNION ALL
        SELECT * FROM (VALUES
          -- SENIOR (SS) variant — senior subjects, same period skeleton
          (1,1,'ENG',NULL),(1,2,'MATHS',NULL),(1,3,'PHY',NULL),(1,4,'CHE',NULL),(1,5,'BIO',NULL),(1,6,'ECON',NULL),(1,7,'V.Arts','P.Arts'),(1,8,'GEO',NULL),(1,9,'LIT',NULL),
          (2,1,'MATHS',NULL),(2,2,'ENG',NULL),(2,3,'CHE',NULL),(2,4,'PHY',NULL),(2,5,'BIO',NULL),(2,6,'GEO',NULL),(2,7,'ECON',NULL),(2,8,'LIT',NULL),(2,9,'AGRIC',NULL),
          (3,1,'BIO',NULL),(3,2,'CHE',NULL),(3,3,'MATHS',NULL),(3,4,'ENG',NULL),(3,5,'PHY',NULL),(3,6,'LIT',NULL),(3,7,'GEO',NULL),(3,8,'H.SCIE','COMP SCIE'),(3,9,'REL.E',NULL),
          (4,1,'PHY',NULL),(4,2,'BIO',NULL),(4,3,'ENG',NULL),(4,4,'MATHS',NULL),(4,5,'CHE',NULL),(4,6,'AGRIC',NULL),(4,7,'ECON',NULL),(4,8,'GEO',NULL),(4,9,'H.SCIE','COMP SCIE'),
          (5,1,'ENG',NULL),(5,2,'MATHS',NULL),(5,3,'GEO',NULL),(5,4,'LIT',NULL),(5,5,'BIO',NULL),(5,6,'CHE',NULL),(5,7,'PHY',NULL),(5,8,'REL.E',NULL),(5,9,'V.Arts','P.Arts')
        ) AS s(day,col,code,alt) WHERE NOT v_junior
      ) grid
    LOOP
      SELECT id INTO v_subj FROM mgmt.subjects WHERE school_id = v_school AND code = g.code LIMIT 1;
      v_alt := NULL;
      IF g.alt IS NOT NULL THEN
        SELECT id INTO v_alt FROM mgmt.subjects WHERE school_id = v_school AND code = g.alt LIMIT 1;
      END IF;
      INSERT INTO mgmt.timetable_slots (school_id, class_id, day_of_week, period_id, subject_id, alt_subject_id)
      VALUES (v_school, v_class.id, g.day, v_pid[teach[g.col]], v_subj, v_alt)
      ON CONFLICT (class_id, section_id, day_of_week, period_id) DO NOTHING;
    END LOOP;

    -- Header/footer meta (approved).
    INSERT INTO mgmt.timetable_meta (school_id, class_id, section_id, title, prepared_by, approved_by, head_of_curriculum, approved, approved_on)
    VALUES (v_school, v_class.id, NULL, v_class.name || ' TIMETABLE', 'Academic Office', 'The Principal', 'Dr. Amara Osei', true, '2026-09-05')
    ON CONFLICT (class_id, section_id) DO NOTHING;
  END LOOP;
END $$;
