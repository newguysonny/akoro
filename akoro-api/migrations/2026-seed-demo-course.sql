-- =============================================================
-- 2026-seed-demo-course.sql
-- Seeds two published demo courses (one LIVE, one VIDEO) — each with
-- 4 modules × 4 lessons (incl. a quiz) — so the course details page can
-- be tested end-to-end via the share link.
--
-- A SINGLE canonical instructor owns them (the earliest-created
-- instructor/admin), so the public catalogue shows exactly one Video and
-- one Live demo course — not one duplicate per instructor.
--
-- Idempotent: re-running won't duplicate. It also cleans up the earlier
-- revision, which seeded these courses once per instructor and made the
-- Discovery / catalogue lists show many identical cards.
-- =============================================================

DO $$
DECLARE
  keep_inst uuid;
  cid     uuid;
  m       uuid;
  i       int;
  mods    text[] := ARRAY[
    'Module 1: Foundations of Calculus',
    'Module 2: Differentiation Techniques',
    'Module 3: Integration',
    'Module 4: Differential Equations'
  ];
  variants record;
BEGIN
  -- Canonical owner: the earliest-created instructor (stable across runs).
  SELECT id INTO keep_inst
  FROM public.users
  WHERE role IN ('instructor','admin')
  ORDER BY created_at NULLS LAST, id
  LIMIT 1;

  IF keep_inst IS NULL THEN
    RETURN;  -- no instructors yet; nothing to seed
  END IF;

  -- ── Dedup: remove demo courses owned by anyone other than the canonical
  -- instructor (left behind by the old per-instructor seed). Child rows
  -- cascade; tasks.course_id is the only non-cascading reference, so clear
  -- it first.
  UPDATE public.tasks SET course_id = NULL
  WHERE course_id IN (
    SELECT id FROM public.courses
    WHERE slug LIKE 'demo-fmaths-%' AND instructor_id <> keep_inst
  );
  DELETE FROM public.courses
  WHERE slug LIKE 'demo-fmaths-%' AND instructor_id <> keep_inst;

  -- ── Seed the two demo courses for the canonical instructor only.
  FOR variants IN
    SELECT * FROM (VALUES
      ('video','Further Mathematics & Calculus (Demo · Video)','demo-fmaths-video'),
      ('live', 'Further Mathematics & Calculus (Demo · Live)', 'demo-fmaths-live')
    ) AS v(ctype, ctitle, cslug)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.courses
      WHERE instructor_id = keep_inst AND slug = variants.cslug || '-' || keep_inst
    ) THEN
      INSERT INTO public.courses
        (instructor_id, title, slug, description, subject, level, language,
         price, is_free, course_type, is_published, published_at,
         total_hours, total_students, rating, created_at, updated_at)
      VALUES
        (keep_inst, variants.ctitle, variants.cslug || '-' || keep_inst,
         'A complete demo course covering limits to differential equations — modules, quizzes, live battles and an AI agent companion. Created for testing all course features.',
         'Further Mathematics', 'advanced', 'English',
         1500000, false, variants.ctype, true, now(),
         48, 847, 4.9, now(), now())
      RETURNING id INTO cid;

      FOR i IN 1..4 LOOP
        INSERT INTO public.course_modules (course_id, title, order_index)
        VALUES (cid, mods[i], i)
        RETURNING id INTO m;

        -- video_url points at a public sample HLS stream so the player works out of the box.
        INSERT INTO public.lessons (module_id, title, lesson_type, duration_seconds, order_index, is_preview, video_url) VALUES
          (m, 'Lesson ' || i || '.1 — Core concepts',   'video', 540, 1, (i = 1), 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'),
          (m, 'Lesson ' || i || '.2 — Worked examples',  'video', 720, 2, false,   'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'),
          (m, 'Lesson ' || i || '.3 — Guided practice',  'video', 660, 3, false,   'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'),
          (m, 'Quiz ' || i || ' — Check your understanding', 'quiz', NULL, 4, false, NULL);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- Backfill: if the demo courses were already seeded before this revision,
-- attach the sample HLS stream to their video lessons.
UPDATE public.lessons l
SET video_url = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
FROM public.course_modules cm
JOIN public.courses c ON c.id = cm.course_id
WHERE l.module_id = cm.id
  AND c.slug LIKE 'demo-fmaths-%'
  AND l.lesson_type = 'video'
  AND (l.video_url IS NULL OR l.video_url = '');

-- Verify:
-- SELECT instructor_id, title, course_type, is_published FROM public.courses WHERE slug LIKE 'demo-fmaths-%';
-- SELECT title, video_url FROM public.lessons l JOIN public.course_modules cm ON cm.id=l.module_id JOIN public.courses c ON c.id=cm.course_id WHERE c.slug LIKE 'demo-fmaths-%' LIMIT 5;
