-- =============================================================
-- 2026-seed-class-subjects.sql
-- Fills the JSS1 class at Akoro Demo Academy with a realistic cohort and
-- SUBJECT-TAGGED XP, so the Subjects ranking board (learner app Rankings tab
-- and the school-website student chat) has something to show.
--
-- What it does:
--   1. Adds 16 classmates to JSS1 (password: Password123!)
--   2. Puts the test learners (priya@ / amaka@) in that same class, so
--      "my class" and "my class subjects" resolve when you log in as them
--   3. Awards XP per (student, subject) across 8 JSS subjects
--   4. Rebuilds the classroom/global/subject leaderboard scopes
--
-- Idempotent: students guarded by email, membership by the UNIQUE
-- (classroom_id, user_id), XP by the 'seed_subject_xp' reason marker, and
-- the leaderboard rebuild is a delete+insert of app-managed scopes.
--
-- Requires 2026-seed-school.sql (creates the school + JSS1) and
-- 2026-xp-subject.sql (adds xp_transactions.subject).
--
-- NOTE: 2026-seed-school-passwords.sql assigns the documented demo passwords
-- POSITIONALLY, ordered by email. It is scoped to the stu.* accounts precisely
-- so the classmates added here cannot shift that mapping.
-- =============================================================

DO $$
DECLARE
  v_pw     text := '$2b$10$HKzqNJTCBHeB0uWSWhf7PeLIOMrlEw2.9oYDI3vQPEs6WAl5Fo7KS'; -- Password123!
  v_school uuid;
  v_class  uuid;
  v_uid    uuid;
  i        int;
  v_names  text[] := ARRAY[
    'Zainab Bello','Ifeanyi Obi','Halima Yusuf','Tunde Adebayo','Chiamaka Eze',
    'Musa Ibrahim','Blessing Okon','Segun Alabi','Aisha Lawal','Kelechi Nwankwo',
    'Damilola Ogun','Fatima Abubakar','Nnamdi Okeke','Yetunde Balogun',
    'Ahmed Suleiman','Precious Etim'];
  v_emojis text[] := ARRAY['🦁','🐯','🦊','🐼','🐨','🦉','🐧','🦅','🐢','🦋','🐝','🐬','🦜','🐙','🦔','🐌'];
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN
    RAISE NOTICE 'Akoro Demo Academy not found — run 2026-seed-school.sql first. Skipping.';
    RETURN;
  END IF;

  SELECT id INTO v_class FROM public.classrooms WHERE school_id = v_school AND name = 'JSS1' LIMIT 1;
  IF v_class IS NULL THEN
    RAISE NOTICE 'JSS1 classroom not found. Skipping.';
    RETURN;
  END IF;

  -- ── 1. 16 classmates ──────────────────────────────────────
  FOR i IN 1..array_length(v_names, 1) LOOP
    SELECT id INTO v_uid FROM public.users WHERE email = 'jss1.mate' || i || '@demo.akoro.app';
    IF v_uid IS NULL THEN
      INSERT INTO public.users (email, username, password_hash, full_name, role, is_active, avatar_emoji)
      VALUES ('jss1.mate' || i || '@demo.akoro.app', 'jss1_mate' || i, v_pw, v_names[i], 'student', true, v_emojis[i])
      RETURNING id INTO v_uid;
    END IF;
    INSERT INTO public.classroom_students (classroom_id, user_id, status)
    VALUES (v_class, v_uid, 'active')
    ON CONFLICT (classroom_id, user_id) DO UPDATE SET status = 'active';
  END LOOP;

  -- ── 2. The accounts you actually test with join the same class ──
  FOR v_uid IN
    SELECT id FROM public.users WHERE email IN ('priya@student.akoro.app', 'amaka@student.akoro.app')
  LOOP
    INSERT INTO public.classroom_students (classroom_id, user_id, status)
    VALUES (v_class, v_uid, 'active')
    ON CONFLICT (classroom_id, user_id) DO UPDATE SET status = 'active';
  END LOOP;
END $$;

-- ── 3. Subject XP for every JSS1 member ──────────────────────
-- One row per (student, subject). Amounts are derived from a hash of the pair
-- so the board has a stable, believable spread instead of everyone tying —
-- and so re-running produces identical numbers.
INSERT INTO public.xp_transactions (user_id, reason, subject, amount)
SELECT cs.user_id, 'seed_subject_xp', s.subject,
       (120 + (abs(hashtext(cs.user_id::text || s.subject)) % 1450))
FROM public.classroom_students cs
JOIN public.classrooms c        ON c.id = cs.classroom_id
JOIN public.school_profiles sp  ON sp.id = c.school_id
CROSS JOIN (VALUES
  ('Mathematics'), ('English Language'), ('Basic Science'), ('Social Studies'),
  ('Civic Education'), ('Agricultural Science'), ('Computer Studies'), ('Business Studies')
) AS s(subject)
WHERE sp.name = 'Akoro Demo Academy' AND c.name = 'JSS1' AND cs.status = 'active'
  -- Not everyone studies everything: skip ~1 subject in 6 so the boards differ
  -- from each other rather than being the same ordering eight times.
  AND (abs(hashtext(cs.user_id::text || s.subject || 'skip')) % 6) <> 0
  AND NOT EXISTS (
    SELECT 1 FROM public.xp_transactions x
    WHERE x.user_id = cs.user_id AND x.reason = 'seed_subject_xp' AND x.subject = s.subject
  );

-- ── 4. Rebuild app-managed leaderboard scopes ────────────────
DELETE FROM public.xp_leaderboard WHERE scope IN ('global', 'classroom', 'subject');

INSERT INTO public.xp_leaderboard (user_id, scope, total_xp, rank, updated_at)
SELECT user_id, 'global', SUM(amount),
       rank() OVER (ORDER BY SUM(amount) DESC), now()
FROM public.xp_transactions
GROUP BY user_id;

INSERT INTO public.xp_leaderboard (user_id, scope, classroom_id, scope_ref_id, total_xp, rank, updated_at)
SELECT cs.user_id, 'classroom', cs.classroom_id, cs.classroom_id, g.total_xp,
       rank() OVER (PARTITION BY cs.classroom_id ORDER BY g.total_xp DESC), now()
FROM public.classroom_students cs
JOIN (SELECT user_id, SUM(amount) AS total_xp FROM public.xp_transactions GROUP BY user_id) g
  ON g.user_id = cs.user_id
WHERE cs.status = 'active';

INSERT INTO public.xp_leaderboard (user_id, scope, subject, total_xp, rank, updated_at)
SELECT user_id, 'subject', subject, SUM(amount),
       rank() OVER (PARTITION BY subject ORDER BY SUM(amount) DESC), now()
FROM public.xp_transactions
WHERE subject IS NOT NULL
GROUP BY user_id, subject;

-- Verify:
-- SELECT u.full_name, x.subject, SUM(x.amount) AS xp
-- FROM public.xp_transactions x
-- JOIN public.users u ON u.id = x.user_id
-- WHERE x.reason = 'seed_subject_xp'
-- GROUP BY u.full_name, x.subject ORDER BY x.subject, xp DESC;
