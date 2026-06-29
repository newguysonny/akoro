-- =============================================================
-- 2026-seed-demo-course.sql
-- Gives every instructor two published demo courses (one LIVE, one VIDEO)
-- — each with 4 modules × 4 lessons (incl. a quiz) — so the course details
-- page can be tested end-to-end via the share link.
--
-- Idempotent: re-running won't duplicate (guarded by a per-instructor slug).
-- Run once in Supabase SQL Editor.
-- =============================================================

DO $$
DECLARE
  inst    RECORD;
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
  FOR inst IN SELECT id FROM public.users WHERE role IN ('instructor','admin') LOOP
    FOR variants IN
      SELECT * FROM (VALUES
        ('video','Further Mathematics & Calculus (Demo · Video)','demo-fmaths-video'),
        ('live', 'Further Mathematics & Calculus (Demo · Live)', 'demo-fmaths-live')
      ) AS v(ctype, ctitle, cslug)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.courses
        WHERE instructor_id = inst.id AND slug = variants.cslug || '-' || inst.id
      ) THEN
        INSERT INTO public.courses
          (instructor_id, title, slug, description, subject, level, language,
           price, is_free, course_type, is_published, published_at,
           total_hours, total_students, rating, created_at, updated_at)
        VALUES
          (inst.id, variants.ctitle, variants.cslug || '-' || inst.id,
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
