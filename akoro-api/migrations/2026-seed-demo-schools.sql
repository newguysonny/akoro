-- =============================================================
-- 2026-seed-demo-schools.sql
-- Seeds a few schools + classrooms + members so the Inter-Schools ranking
-- board shows a real ranking of multiple schools (not just one).
--
-- Runs BEFORE 2026-seed-ranking-xp.sql so these classroom members get XP and
-- the schools aggregate a meaningful total. Idempotent (guarded by name).
-- =============================================================

DO $$
DECLARE
  admin1     uuid;
  sid        uuid;
  cid        uuid;
  s          record;
  classes    uuid[] := '{}';
BEGIN
  SELECT id INTO admin1 FROM public.users
  WHERE role IN ('admin', 'instructor')
  ORDER BY created_at NULLS LAST, id LIMIT 1;

  IF admin1 IS NULL THEN
    RAISE NOTICE 'no admin/instructor — skipping demo schools';
    RETURN;
  END IF;

  FOR s IN SELECT * FROM (VALUES
    ('Westwood Academy'), ('Riverside High'), ('Summit Prep')
  ) AS v(name)
  LOOP
    SELECT id INTO sid FROM public.school_profiles WHERE name = s.name;
    IF sid IS NULL THEN
      INSERT INTO public.school_profiles (admin_user_id, name, description, is_active)
      VALUES (admin1, s.name, 'Demo school for the inter-school leaderboard', true)
      RETURNING id INTO sid;
    END IF;

    SELECT id INTO cid FROM public.classrooms WHERE school_id = sid AND name = s.name || ' · Class A';
    IF cid IS NULL THEN
      INSERT INTO public.classrooms (teacher_id, school_id, name)
      VALUES (admin1, sid, s.name || ' · Class A')
      RETURNING id INTO cid;
    END IF;

    classes := array_append(classes, cid);
  END LOOP;

  -- Distribute students + instructors round-robin across the three schools.
  -- Guarded by membership in THESE demo classrooms, so re-runs are no-ops.
  INSERT INTO public.classroom_students (user_id, classroom_id, status)
  SELECT u.id,
         classes[1 + (abs(hashtext(u.id::text)) % array_length(classes, 1))],
         'active'
  FROM public.users u
  WHERE u.role IN ('student', 'instructor')
    -- Not the agent testers: their school links are deliberate fixtures
    -- (tester31-50 have no school, so coin entry bills their own wallet).
    AND NOT (u.username ~ '^tester[0-9]{2}$' AND u.email LIKE '%@demo.akoro.app')
    AND NOT EXISTS (
      SELECT 1 FROM public.classroom_students cs
      WHERE cs.user_id = u.id AND cs.classroom_id = ANY(classes)
    )
  ON CONFLICT (classroom_id, user_id) DO NOTHING;
END $$;

-- Verify:
-- SELECT sp.name, count(cs.*) students
--   FROM public.school_profiles sp
--   JOIN public.classrooms c ON c.school_id = sp.id
--   LEFT JOIN public.classroom_students cs ON cs.classroom_id = c.id
--   GROUP BY sp.name ORDER BY students DESC;
