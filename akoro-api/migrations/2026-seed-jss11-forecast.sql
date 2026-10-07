-- =============================================================
-- 2026-seed-jss11-forecast.sql  —  demo group (auto-runs on deploy)
--
-- Pre-fills THIS week's Weekly Forecast for every JSS 11 section by mirroring
-- the timetable onto the scheme of work: each period gets its subject's topic
-- for First Term · Week 1 (a one-line highlight — no details), so the Weekly
-- Forecast page shows a full day/week plan out of the box for testing.
--
-- Mirrors what POST /forecast/generate does, in SQL, for all sections.
-- Runs after the timetable + scheme seeds. Idempotent: rebuilt each deploy.
-- Reversible via 2026-teardown-jss11-all-sections.sql.
-- =============================================================
DO $$
DECLARE
  v_email  text := 'stu.jss11@demo.akoro.app';
  v_user   uuid;
  v_school uuid;
  v_class  uuid;
  v_mon    date := date_trunc('week', CURRENT_DATE)::date;   -- Monday of this week
  v_term   text := 'First Term';
  v_week   text := 'Week 1';
  sec      RECORD;
  v_week_id uuid;
  v_secs   int := 0;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE lower(email) = lower(v_email);
  IF v_user IS NOT NULL THEN
    SELECT c.school_id INTO v_school
    FROM public.classroom_students cs JOIN public.classrooms c ON c.id = cs.classroom_id
    WHERE cs.user_id = v_user AND c.school_id IS NOT NULL LIMIT 1;
  END IF;
  IF v_school IS NULL THEN SELECT id INTO v_school FROM public.school_profiles ORDER BY created_at LIMIT 1; END IF;
  IF v_school IS NULL THEN RAISE NOTICE 'No school — skipping JSS 11 forecast seed.'; RETURN; END IF;

  SELECT id INTO v_class FROM mgmt.classes WHERE school_id = v_school AND name = 'JSS 11' LIMIT 1;
  IF v_class IS NULL THEN RAISE NOTICE 'No JSS 11 class — skipping forecast seed.'; RETURN; END IF;

  FOR sec IN SELECT id, name FROM mgmt.sections WHERE school_id = v_school AND class_id = v_class ORDER BY name
  LOOP
    v_secs := v_secs + 1;

    -- Week header for this section.
    INSERT INTO mgmt.forecast_weeks (school_id, class_id, section_id, week_start, week_end, theme, prepared_by)
    VALUES (v_school, v_class, sec.id, v_mon, v_mon + 4, v_term || ' · ' || v_week, 'Academics Office')
    ON CONFLICT (class_id, section_id, week_start)
      DO UPDATE SET week_end = EXCLUDED.week_end, theme = EXCLUDED.theme, updated_at = now()
    RETURNING id INTO v_week_id;

    -- Rebuild the cells from timetable × scheme (topic per subject per period).
    DELETE FROM mgmt.forecast_cells WHERE week_id = v_week_id;
    INSERT INTO mgmt.forecast_cells (school_id, week_id, day_of_week, period_id, activity)
    SELECT v_school, v_week_id, ts.day_of_week, ts.period_id, sw.topic
    FROM mgmt.timetable_slots ts
    JOIN mgmt.scheme_of_work sw
      ON sw.class_id = ts.class_id AND sw.subject_id = ts.subject_id
     AND sw.term = v_term AND sw.week = v_week
    WHERE ts.class_id = v_class AND ts.section_id = sec.id;
  END LOOP;

  RAISE NOTICE 'Seeded JSS 11 weekly forecast for % section(s), week of %.', v_secs, v_mon;
END $$;
