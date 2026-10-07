-- =============================================================
-- 2026-seed-jss1-battle-ready.sql
-- Makes the JSS1 demo class actually usable for class battles and self study.
--
-- Two things were missing, and both fail quietly rather than loudly:
--
--  1. NOBODY IN JSS1 HAS AN AGENT. A battle is agent vs agent, so every
--     classmate showed as "no agent", the roster greyed out entirely, and
--     creating a battle answered "None of those classmates can battle yet".
--     Nothing in the seeds ever created user_agents for them.
--
--  2. THE CLASS HAS NO SUBJECTS. public.classrooms (who is in the room) and
--     mgmt.classes (the academic structure) line up by school and name, and
--     both contain 'JSS1' — but the demo's class_subjects were attached to a
--     DIFFERENT class called 'JSS 11'. So the subject dropdown fell back to
--     whatever the past-questions bank could supply instead of the school's own.
--
-- Subjects here are deliberately the four the NCEE bank actually covers, so a
-- class battle can be filled from real past questions rather than only from AI.
--
-- Idempotent: agents guarded by the UNIQUE (user_id), subjects by name, and
-- class_subjects by its UNIQUE (class_id, subject_id).
--
-- Requires 2026-seed-school.sql (school + JSS1 classroom), 2026-seed-mgmt.sql
-- (mgmt.classes JSS1) and 2026-seed-class-subjects.sql (the 16 classmates).
-- =============================================================

DO $$
DECLARE
  v_school  uuid;
  v_room    uuid;
  v_class   uuid;
  v_subj    uuid;
  v_name    text;
  r         record;
  v_emojis  text[] := ARRAY['🤖','🦉','🧠','📚','🔬','🎓','⚡','🌟','🧭','🐝','🦊','🐼','🐧','🦅','🐢','🦋','🐬','🦜'];
  v_i       int := 0;
  v_agents  int := 0;
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN
    RAISE NOTICE 'Akoro Demo Academy not found — run 2026-seed-school.sql first. Skipping.';
    RETURN;
  END IF;

  SELECT id INTO v_room FROM public.classrooms WHERE school_id = v_school AND name = 'JSS1' LIMIT 1;
  IF v_room IS NULL THEN
    RAISE NOTICE 'JSS1 classroom not found. Skipping.';
    RETURN;
  END IF;

  -- ── 1. An agent for every active member of JSS1 ───────────────────────
  -- Including the teacher: they join their own class battle as a referee, but
  -- the invite route still resolves an agent for whoever creates it.
  FOR r IN
    SELECT u.id, u.full_name
    FROM public.classroom_students cs
    JOIN public.users u ON u.id = cs.user_id
    WHERE cs.classroom_id = v_room AND cs.status = 'active'
    UNION
    SELECT u.id, u.full_name
    FROM public.classrooms c
    JOIN public.users u ON u.id = c.teacher_id
    WHERE c.id = v_room
  LOOP
    v_i := v_i + 1;
    INSERT INTO public.user_agents (user_id, agent_name, agent_emoji, agent_color, agent_bg, is_active)
    VALUES (
      r.id,
      COALESCE(split_part(r.full_name, ' ', 1), 'Learner') || '''s Agent',
      v_emojis[1 + (v_i % array_length(v_emojis, 1))],
      '#E8884A', '#FEF0E6', true
    )
    ON CONFLICT (user_id) DO NOTHING;
    IF FOUND THEN v_agents := v_agents + 1; END IF;
  END LOOP;

  RAISE NOTICE 'JSS1: % agents created (members without one already)', v_agents;

  -- ── 2. Subjects on the mgmt class that shares the classroom's name ────
  SELECT id INTO v_class FROM mgmt.classes WHERE school_id = v_school AND name = 'JSS1' LIMIT 1;
  IF v_class IS NULL THEN
    INSERT INTO mgmt.classes (school_id, name, sort_order) VALUES (v_school, 'JSS1', 1)
    RETURNING id INTO v_class;
  END IF;

  -- Only subjects the NCEE past-questions bank can actually fill a battle from,
  -- so "Question bank only" is a real choice here and not just a way to fail.
  FOREACH v_name IN ARRAY ARRAY['Mathematics', 'English Language', 'Basic Science', 'Social Studies']
  LOOP
    SELECT id INTO v_subj FROM mgmt.subjects WHERE school_id = v_school AND name = v_name;
    IF v_subj IS NULL THEN
      INSERT INTO mgmt.subjects (school_id, name, code, subject_type)
      VALUES (v_school, v_name, upper(left(replace(v_name, ' ', ''), 3)), 'core')
      RETURNING id INTO v_subj;
    END IF;

    INSERT INTO mgmt.class_subjects (school_id, class_id, subject_id, is_elective)
    VALUES (v_school, v_class, v_subj, false)
    ON CONFLICT (class_id, subject_id) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'JSS1: subjects attached to mgmt class %', v_class;
END $$;

-- Verify:
--   SELECT u.full_name, u.username, u.email, (a.id IS NOT NULL) AS has_agent
--   FROM public.classroom_students cs
--   JOIN public.users u ON u.id = cs.user_id
--   LEFT JOIN public.user_agents a ON a.user_id = u.id
--   JOIN public.classrooms c ON c.id = cs.classroom_id
--   JOIN public.school_profiles s ON s.id = c.school_id
--   WHERE s.name = 'Akoro Demo Academy' AND c.name = 'JSS1' AND cs.status = 'active'
--   ORDER BY u.full_name;
