-- =============================================================
-- 2026-seed-jss11-all-sections.sql  —  demo group (auto-runs on deploy)
--
-- FULL-TESTING seed: populates EVERY existing section of the JSS 11 class
-- with a real weekly timetable and per-section teaching materials, plus
-- class-level subject assignments, a scheme of work and today's classwork.
--
-- Complements 2026-seed-demo-jss11.sql (which only wires section A for the
-- demo student). Runs immediately AFTER it, so the section-A demo stays
-- consistent and every other section (B, C, …) gets the same real data.
--
-- Idempotent + fail-safe: resolves the same school as the demo seed, skips
-- quietly if the JSS 11 class or its sections are absent, and rebuilds
-- per-section timetable cleanly on each deploy.
--
-- Everything this migration adds is REVERSIBLE via
-- 2026-teardown-jss11-all-sections.sql (NOT in the manifest — run by hand
-- when you're done testing). Per-section materials are tagged in `note` with
-- the marker '[seed:jss11-allsec]' so the teardown removes exactly these rows.
-- =============================================================
DO $$
DECLARE
  v_email  text := 'stu.jss11@demo.akoro.app';
  v_school uuid;
  v_class  uuid;
  v_math uuid; v_eng uuid; v_bio uuid; v_phy uuid; v_chem uuid; v_geo uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid;
  v_user uuid;
  sec RECORD;
  v_secs int := 0;
  v_tag text := '[seed:jss11-allsec]';
BEGIN
  -- 1. Resolve the same school the demo seed uses (student's classroom → else first school).
  SELECT id INTO v_user FROM public.users WHERE lower(email) = lower(v_email);
  IF v_user IS NOT NULL THEN
    SELECT c.school_id INTO v_school
    FROM public.classroom_students cs JOIN public.classrooms c ON c.id = cs.classroom_id
    WHERE cs.user_id = v_user AND c.school_id IS NOT NULL LIMIT 1;
  END IF;
  IF v_school IS NULL THEN SELECT id INTO v_school FROM public.school_profiles ORDER BY created_at LIMIT 1; END IF;
  IF v_school IS NULL THEN RAISE NOTICE 'No school found — skipping JSS 11 all-sections seed.'; RETURN; END IF;

  -- 2. Resolve the JSS 11 class (created by the demo seed). Skip if absent.
  SELECT id INTO v_class FROM mgmt.classes WHERE school_id = v_school AND name = 'JSS 11' LIMIT 1;
  IF v_class IS NULL THEN RAISE NOTICE 'No JSS 11 class for school % — skipping.', v_school; RETURN; END IF;

  -- 3. Ensure subjects exist and capture ids (upsert; harmless if already seeded).
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

  -- 4. Ensure periods (daily bells) and capture ids.
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

  -- 5. Class-level subject assignments (shared across sections; idempotent).
  INSERT INTO mgmt.class_subjects (school_id, class_id, subject_id, is_elective) VALUES
    (v_school,v_class,v_math,false),(v_school,v_class,v_eng,false),(v_school,v_class,v_bio,false),
    (v_school,v_class,v_phy,false),(v_school,v_class,v_chem,false),(v_school,v_class,v_geo,true)
  ON CONFLICT (class_id, subject_id) DO NOTHING;

  -- 6. Per-section weekly timetable + teaching materials for EVERY section of JSS 11.
  FOR sec IN
    SELECT id, name FROM mgmt.sections WHERE school_id = v_school AND class_id = v_class ORDER BY name
  LOOP
    v_secs := v_secs + 1;

    -- 6a. Rebuild this section's timetable (Mon=1 … Fri=5) cleanly.
    DELETE FROM mgmt.timetable_slots WHERE class_id = v_class AND section_id = sec.id;
    INSERT INTO mgmt.timetable_slots (school_id, class_id, section_id, day_of_week, period_id, subject_id) VALUES
      (v_school,v_class,sec.id,1,p1,v_math),(v_school,v_class,sec.id,1,p2,v_eng),(v_school,v_class,sec.id,1,p3,v_bio),(v_school,v_class,sec.id,1,p4,v_phy),(v_school,v_class,sec.id,1,p5,v_geo),
      (v_school,v_class,sec.id,2,p1,v_eng),(v_school,v_class,sec.id,2,p2,v_math),(v_school,v_class,sec.id,2,p3,v_chem),(v_school,v_class,sec.id,2,p4,v_bio),(v_school,v_class,sec.id,2,p5,v_phy),
      (v_school,v_class,sec.id,3,p1,v_math),(v_school,v_class,sec.id,3,p2,v_phy),(v_school,v_class,sec.id,3,p3,v_eng),(v_school,v_class,sec.id,3,p4,v_chem),(v_school,v_class,sec.id,3,p5,v_bio),
      (v_school,v_class,sec.id,4,p1,v_chem),(v_school,v_class,sec.id,4,p2,v_bio),(v_school,v_class,sec.id,4,p3,v_math),(v_school,v_class,sec.id,4,p4,v_eng),(v_school,v_class,sec.id,4,p5,v_geo),
      (v_school,v_class,sec.id,5,p1,v_phy),(v_school,v_class,sec.id,5,p2,v_chem),(v_school,v_class,sec.id,5,p3,v_geo),(v_school,v_class,sec.id,5,p4,v_math),(v_school,v_class,sec.id,5,p5,v_eng);

    -- 6b. Per-section teaching materials (tagged for clean teardown). Rebuild each run.
    DELETE FROM mgmt.learning_resources
      WHERE class_id = v_class AND section_id = sec.id AND note LIKE v_tag || '%';
    INSERT INTO mgmt.learning_resources (school_id, class_id, section_id, subject_id, title, resource_type, url, note) VALUES
      (v_school,v_class,sec.id,v_math,'JSS 11'||sec.name||' — Number Bases (Notes)','document','', v_tag||' Number bases and modular arithmetic — worked notes for section '||sec.name||'.'),
      (v_school,v_class,sec.id,v_eng, 'JSS 11'||sec.name||' — Comprehension Worksheet','link','https://example.com/jss11-comprehension.pdf', v_tag||' Reading comprehension & summary practice for section '||sec.name||'.'),
      (v_school,v_class,sec.id,v_bio, 'JSS 11'||sec.name||' — The Cell (Video)','video','https://www.youtube.com/results?search_query='||replace('plant and animal cell structure',' ','+'), v_tag||' Intro video on cell structure for section '||sec.name||'.');
  END LOOP;

  IF v_secs = 0 THEN
    RAISE NOTICE 'JSS 11 has no sections yet — seeded subjects only. Create sections then re-deploy.';
  END IF;

  -- 7. Class-level scheme of work + today's classwork (shared; only add if missing
  --    so we never stomp the demo seed's own rows).
  IF NOT EXISTS (SELECT 1 FROM mgmt.syllabus_items WHERE class_id = v_class) THEN
    INSERT INTO mgmt.syllabus_items (school_id, class_id, subject_id, term, topic, description, status) VALUES
      (v_school,v_class,v_math,'First Term','Number bases and modular arithmetic','Operations and conversion in bases 2–10; modulo arithmetic.','covered'),
      (v_school,v_class,v_eng, 'First Term','Comprehension and summary writing','Reading for meaning; summarising passages.','covered'),
      (v_school,v_class,v_bio, 'First Term','The cell and its structure','Plant vs animal cells; organelles and functions.','covered'),
      (v_school,v_class,v_phy, 'First Term','Measurement and units','Fundamental and derived quantities; instruments.','pending'),
      (v_school,v_class,v_chem,'First Term','Particulate nature of matter','States of matter; atoms, molecules and ions.','pending');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM mgmt.classwork_logs WHERE class_id = v_class AND log_date = CURRENT_DATE) THEN
    INSERT INTO mgmt.classwork_logs (school_id, class_id, subject_id, log_date, topic, notes) VALUES
      (v_school,v_class,v_math,CURRENT_DATE,'Number bases and modular arithmetic','Converted between bases 2–10 and solved modulo problems.'),
      (v_school,v_class,v_eng, CURRENT_DATE,'Comprehension and summary writing','Read a passage and wrote a one-paragraph summary.'),
      (v_school,v_class,v_bio, CURRENT_DATE,'The cell and its structure','Labelled plant and animal cells; discussed organelle functions.');
  END IF;

  RAISE NOTICE 'Seeded JSS 11 across % section(s) for school %.', v_secs, v_school;
END $$;
