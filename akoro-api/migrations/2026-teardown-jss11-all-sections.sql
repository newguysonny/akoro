-- =============================================================
-- 2026-teardown-jss11-all-sections.sql  —  MANUAL (not in manifest.json)
--
-- Reverses 2026-seed-jss11-all-sections.sql after full testing.
--
-- Removes exactly the full-testing additions:
--   • all per-section teaching materials tagged '[seed:jss11-allsec]'
--   • timetable slots for every JSS 11 section EXCEPT 'A'
--     (section A is the demo seed's — left intact so the demo keeps working)
--   • the full week-by-week scheme of work seeded for the JSS 11 class
--     (2026-seed-jss11-scheme.sql)
--   • the seeded weekly forecast for the JSS 11 class
--     (2026-seed-jss11-forecast.sql)
--
-- Run once by hand with your DB URL:
--   MIGRATION_DATABASE_URL=postgres://…:5432/postgres \
--     psql "$MIGRATION_DATABASE_URL" -f migrations/2026-teardown-jss11-all-sections.sql
--
-- IMPORTANT: also delete the three seed files from the "demo" array in
-- manifest.json (and delete the files) — 2026-seed-jss11-all-sections.sql,
-- 2026-seed-jss11-scheme.sql and 2026-seed-jss11-forecast.sql — otherwise the
-- next deploy re-seeds them. This teardown is idempotent and safe to re-run.
-- =============================================================
DO $$
DECLARE
  v_email  text := 'stu.jss11@demo.akoro.app';
  v_user   uuid;
  v_school uuid;
  v_class  uuid;
  v_tag    text := '[seed:jss11-allsec]';
  v_mats   int;
  v_slots  int;
BEGIN
  SELECT id INTO v_user FROM public.users WHERE lower(email) = lower(v_email);
  IF v_user IS NOT NULL THEN
    SELECT c.school_id INTO v_school
    FROM public.classroom_students cs JOIN public.classrooms c ON c.id = cs.classroom_id
    WHERE cs.user_id = v_user AND c.school_id IS NOT NULL LIMIT 1;
  END IF;
  IF v_school IS NULL THEN SELECT id INTO v_school FROM public.school_profiles ORDER BY created_at LIMIT 1; END IF;
  IF v_school IS NULL THEN RAISE NOTICE 'No school found — nothing to tear down.'; RETURN; END IF;

  SELECT id INTO v_class FROM mgmt.classes WHERE school_id = v_school AND name = 'JSS 11' LIMIT 1;
  IF v_class IS NULL THEN RAISE NOTICE 'No JSS 11 class — nothing to tear down.'; RETURN; END IF;

  -- 1. Tagged per-section teaching materials (all sections).
  DELETE FROM mgmt.learning_resources
    WHERE class_id = v_class AND note LIKE v_tag || '%';
  GET DIAGNOSTICS v_mats = ROW_COUNT;

  -- 2. Timetable for every section except the demo section 'A'.
  DELETE FROM mgmt.timetable_slots
    WHERE class_id = v_class
      AND section_id IN (
        SELECT id FROM mgmt.sections
        WHERE school_id = v_school AND class_id = v_class AND name <> 'A'
      );
  GET DIAGNOSTICS v_slots = ROW_COUNT;

  -- 3. Full week-by-week scheme of work seeded for this class
  --    (2026-seed-jss11-scheme.sql). Class-scoped, so remove it all.
  DELETE FROM mgmt.scheme_of_work WHERE class_id = v_class;

  -- 4. Weekly forecast seeded for this class (2026-seed-jss11-forecast.sql).
  --    Cells cascade from the week header.
  DELETE FROM mgmt.forecast_weeks WHERE class_id = v_class;

  -- Optional TOTAL wipe (uncomment to also remove the class-level extras this
  -- seed added — only do this if the demo student no longer needs them):
  -- DELETE FROM mgmt.class_subjects WHERE class_id = v_class;
  -- DELETE FROM mgmt.timetable_slots WHERE class_id = v_class;   -- also removes section A

  RAISE NOTICE 'Torn down JSS 11 full-section seed: % material(s), % timetable slot(s), scheme cleared.', v_mats, v_slots;
END $$;
