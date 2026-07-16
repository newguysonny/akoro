-- =============================================================
-- 2026-seed-demo-live-classes.sql
-- Populates the catalogue for golden-path testing:
--   · extra published VIDEO courses (discover → purchase → enrol → watch)
--   · extra published LIVE courses that run on a daily cadence
--   · one special "Rapid Live Demo" course that goes live every 10 minutes
--     so the live-session flow (updates, going-live, join) can be tested fast
--
-- All courses are owned by the single canonical instructor (earliest-created)
-- so the catalogue shows one card each — no per-instructor duplicates.
--
-- Recurring sessions are kept fresh forever by the live-session scheduler
-- (modules/courses/scheduler.js → ensureDemoSessions). This seed only lays
-- down the courses, their curriculum, and an initial batch of sessions so
-- there is data to see immediately after a deploy.
--
-- Idempotent: courses guarded by slug; initial sessions only seeded when a
-- course has none yet.
-- =============================================================

DO $$
DECLARE
  keep_inst uuid;
  cid       uuid;
  m         uuid;
  i         int;
  cdef      record;
  mods      text[] := ARRAY['Getting Started', 'Core Concepts', 'Applied Practice'];
BEGIN
  SELECT id INTO keep_inst
  FROM public.users
  WHERE role IN ('instructor','admin')
  ORDER BY created_at NULLS LAST, id
  LIMIT 1;

  IF keep_inst IS NULL THEN
    RETURN;  -- no instructors yet
  END IF;

  -- ── Courses (video + live) ──────────────────────────────────
  FOR cdef IN
    SELECT * FROM (VALUES
      -- ctype , title                                        , slug                , subject             , level        , is_free, price
      ('video','Waves & Optics (Demo · Video)',                'demo-physics-video',  'Physics',            'intermediate', false, 1200000),
      ('video','Organic Chemistry Foundations (Demo · Video)', 'demo-chem-video',     'Chemistry',          'beginner',     false, 1000000),
      ('video','Cell Biology & Genetics (Demo · Video)',       'demo-bio-video',      'Biology',            'intermediate', false, 1100000),
      ('video','Intro to Python Programming (Demo · Video)',   'demo-cs-video',       'Computer Science',   'beginner',     true,        0),
      ('video','Essay Writing Mastery (Demo · Video)',         'demo-english-video',  'English Language',   'all',          false,  800000),
      ('video','Microeconomics Basics (Demo · Video)',         'demo-econ-video',     'Economics',          'beginner',     false,  900000),
      ('live', 'Daily Maths Live Class (Demo · Live)',         'demo-maths-live',     'Mathematics',        'all',          false, 1500000),
      ('live', 'Physics Live Clinic (Demo · Live)',            'demo-physics-live',   'Physics',            'intermediate', false, 1500000),
      ('live', 'Chemistry Live Tutorials (Demo · Live)',       'demo-chem-live',      'Chemistry',          'intermediate', false, 1400000),
      ('live', 'Rapid Live Demo — Goes Live Every 10 Min',     'demo-live-rapid',     'Further Mathematics','all',          true,        0)
    ) AS d(ctype, ctitle, cslug, subj, lvl, isfree, prc)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.courses WHERE slug = cdef.cslug) THEN
      INSERT INTO public.courses
        (instructor_id, title, slug, description, subject, level, language,
         price, is_free, course_type, is_published, published_at,
         total_hours, total_students, rating,
         platform, session_length_min, schedule_pattern, created_at, updated_at)
      VALUES
        (keep_inst, cdef.ctitle, cdef.cslug,
         'Demo ' || cdef.subj || ' course for testing the golden path — discovery, purchase, enrolment, live updates and sessions.',
         cdef.subj, cdef.lvl, 'English',
         cdef.prc, cdef.isfree, cdef.ctype, true, now(),
         24, (200 + floor(random() * 800))::int, 4.7,
         CASE WHEN cdef.ctype = 'live' THEN 'zoom' END,
         CASE WHEN cdef.ctype = 'live' THEN 60   END,
         CASE WHEN cdef.ctype = 'live' THEN 'weekly' END,
         now(), now())
      RETURNING id INTO cid;

      FOR i IN 1..3 LOOP
        INSERT INTO public.course_modules (course_id, title, order_index)
        VALUES (cid, 'Module ' || i || ': ' || mods[i], i)
        RETURNING id INTO m;

        INSERT INTO public.lessons (module_id, title, lesson_type, duration_seconds, order_index, is_preview, video_url) VALUES
          (m, 'Lesson ' || i || '.1 — Overview',   'video', 480, 1, (i = 1), 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'),
          (m, 'Lesson ' || i || '.2 — Deep dive',  'video', 600, 2, false,   'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'),
          (m, 'Quiz ' || i || ' — Check yourself', 'quiz', NULL, 3, false,   NULL);
      END LOOP;
    END IF;
  END LOOP;

  -- ── Initial live sessions (only when a live course has none yet) ──
  -- The scheduler keeps these topped up going forward; this is just so
  -- the catalogue isn't empty right after a fresh deploy.
  FOR cdef IN
    SELECT id, title, subject, slug FROM public.courses
    WHERE is_published AND course_type = 'live'
      AND (slug LIKE 'demo-%live%' OR slug = 'demo-live-rapid')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.live_sessions WHERE course_id = cdef.id) THEN
      IF cdef.slug = 'demo-live-rapid' THEN
        -- Three sessions at 10-minute spacing so one goes live almost immediately.
        INSERT INTO public.live_sessions
          (course_id, instructor_id, title, topic, subject, session_type, platform,
           scheduled_start, scheduled_end, max_participants, current_participants, status)
        SELECT cdef.id, keep_inst, '⚡ Rapid Demo Session', 'Live flow test', cdef.subject,
               'class', 'zoom', s.start, s.start + interval '10 minutes', 50,
               floor(random() * 15)::int, 'scheduled'
        FROM (VALUES
          (now() + interval '2 minutes'),
          (now() + interval '12 minutes'),
          (now() + interval '22 minutes')
        ) AS s(start);
      ELSE
        -- Daily cadence: today, tomorrow, day-after (all early evening-ish).
        INSERT INTO public.live_sessions
          (course_id, instructor_id, title, topic, subject, session_type, platform,
           scheduled_start, scheduled_end, max_participants, current_participants, status)
        SELECT cdef.id, keep_inst, cdef.title || ' — Session', cdef.subject, cdef.subject,
               'class', 'zoom', s.start, s.start + interval '1 hour', 50,
               floor(random() * 30)::int, 'scheduled'
        FROM (VALUES
          (now() + interval '3 hours'),
          (now() + interval '1 day 3 hours'),
          (now() + interval '2 days 3 hours')
        ) AS s(start);
      END IF;
    END IF;
  END LOOP;
END $$;

-- Verify:
-- SELECT title, course_type, is_published, price FROM public.courses WHERE slug LIKE 'demo-%' ORDER BY course_type, title;
-- SELECT c.title, ls.title, ls.scheduled_start, ls.status
--   FROM public.live_sessions ls JOIN public.courses c ON c.id = ls.course_id
--   WHERE c.slug LIKE 'demo-%' ORDER BY ls.scheduled_start;
