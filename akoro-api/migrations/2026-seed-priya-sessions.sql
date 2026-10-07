-- =============================================================
-- 2026-seed-priya-sessions.sql
-- Populates the learner "Learn" tab for priya@student.akoro.app so all three
-- session views have data to test:
--   · Live Classes  → register her in the demo courses' live_sessions
--   · Agent tab     → edu.adaptive_sessions (teaching sessions she's done)
--   · Revisions tab → edu.knowledge_confidence rows below the review threshold
--
-- Resolves Priya by email (works regardless of how she was created) and is
-- fully idempotent. No-ops if she doesn't exist.
-- =============================================================

DO $$
DECLARE
  pid   uuid;   -- priya's user id
  paid  uuid;   -- priya's active agent id
  pid_t text;   -- priya's id as text (knowledge_confidence.student_id is TEXT)
BEGIN
  SELECT id INTO pid FROM public.users WHERE email = 'priya@student.akoro.app';
  IF pid IS NULL THEN
    RAISE NOTICE 'priya not found — skipping session seed';
    RETURN;
  END IF;
  pid_t := pid::text;

  -- Ensure she has an agent (adaptive_sessions.student_agent_id → user_agents).
  SELECT id INTO paid FROM public.user_agents WHERE user_id = pid ORDER BY created_at NULLS LAST LIMIT 1;
  IF paid IS NULL THEN
    INSERT INTO public.user_agents (user_id, agent_name, agent_emoji, agent_color, agent_bg, is_active)
    VALUES (pid, 'Aria', '🤖', '#6C3BFF', '#EEE9FF', true)
    RETURNING id INTO paid;
  END IF;

  -- ── 1. Live classes — register Priya in the demo live_sessions ──────────
  BEGIN
    INSERT INTO public.session_participants (session_id, user_id, status)
    SELECT ls.id, pid, 'registered'
    FROM public.live_sessions ls
    JOIN public.courses c ON c.id = ls.course_id
    WHERE c.course_type = 'live' AND c.slug LIKE 'demo-%'
      AND ls.status IN ('scheduled', 'live')
      AND NOT EXISTS (SELECT 1 FROM public.session_participants sp WHERE sp.session_id = ls.id AND sp.user_id = pid)
    ON CONFLICT (session_id, user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'priya live-session register skipped: %', SQLERRM; END;

  -- ── 2. Agent sessions — completed / active teaching sessions ────────────
  BEGIN
    INSERT INTO edu.adaptive_sessions (student_id, student_agent_id, topic, subject, subtopics, status, current_phase, completed_at, updated_at, created_at)
    SELECT pid, paid, v.topic, v.subject, v.subtopics::jsonb, v.status, v.phase,
           CASE WHEN v.status = 'complete' THEN now() - (v.days_ago || ' days')::interval END,
           now() - (v.days_ago || ' days')::interval, now() - (v.days_ago || ' days')::interval
    FROM (VALUES
      ('Cell Respiration',            'science', '["ATP Production","Glycolysis","Krebs Cycle"]',                    'complete', 'complete', 3),
      ('Macbeth — Themes & Characters','english','["Ambition & Power","Guilt & Conscience","Lady Macbeth"]',         'complete', 'complete', 5),
      ('Quadratic Equations',         'maths',   '["Factoring","Quadratic Formula"]',                                'active',   '3',        10)
    ) AS v(topic, subject, subtopics, status, phase, days_ago)
    WHERE NOT EXISTS (SELECT 1 FROM edu.adaptive_sessions a WHERE a.student_id = pid AND a.topic = v.topic);
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'priya adaptive_sessions skipped: %', SQLERRM; END;

  -- ── 3a. Healthy confidence for the agent-session subtopics (>= 72, so they
  --        show good progress and DON'T appear as revisions) ───────────────
  BEGIN
    INSERT INTO edu.knowledge_confidence (student_id, agent_id, topic, subject, subtopic, confidence, prev_confidence, assess_count, passed_count, last_assessed)
    SELECT pid_t, paid, v.topic, v.subject, v.subtopic, v.conf, v.conf, 1, 1, now() - (v.days_ago || ' days')::interval
    FROM (VALUES
      ('Cell Respiration',             'science', 'ATP Production',     82, 3),
      ('Cell Respiration',             'science', 'Glycolysis',         78, 3),
      ('Cell Respiration',             'science', 'Krebs Cycle',        80, 3),
      ('Macbeth — Themes & Characters','english', 'Ambition & Power',   87, 5),
      ('Macbeth — Themes & Characters','english', 'Guilt & Conscience', 83, 5),
      ('Quadratic Equations',          'maths',   'Factoring',          76, 10),
      ('Quadratic Equations',          'maths',   'Quadratic Formula',  73, 10)
    ) AS v(topic, subject, subtopic, conf, days_ago)
    ON CONFLICT (student_id, topic, subtopic) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'priya healthy confidence skipped: %', SQLERRM; END;

  -- ── 3b. Decayed confidence → these drive the Revisions tab (< 72) ───────
  BEGIN
    INSERT INTO edu.knowledge_confidence (student_id, agent_id, topic, subject, subtopic, confidence, prev_confidence, assess_count, passed_count, misconceptions, last_assessed)
    SELECT pid_t, paid, v.topic, v.subject, v.subtopic, v.conf, v.prev, 2, 1, v.misc::text[], now() - (v.days_ago || ' days')::interval
    FROM (VALUES
      ('Mitosis & Meiosis',              'science', 'Anaphase vs Telophase', 31, 68, '{"confused anaphase with telophase"}',                     14),
      ('Newton''s Laws & Forces',        'science', 'Force Diagrams',        34, 55, '{"confused acceleration with velocity","incorrect force diagram setup"}', 21),
      ('Themes in To Kill a Mockingbird','english', 'Coming-of-age arc',     48, 80, '{"missed Scout''s arc"}',                                  8)
    ) AS v(topic, subject, subtopic, conf, prev, misc, days_ago)
    ON CONFLICT (student_id, topic, subtopic) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'priya decayed confidence skipped: %', SQLERRM; END;

END $$;

-- Verify:
-- SELECT topic, status FROM edu.adaptive_sessions a JOIN public.users u ON u.id=a.student_id WHERE u.email='priya@student.akoro.app';
-- SELECT topic, subtopic, confidence FROM edu.knowledge_confidence WHERE student_id=(SELECT id::text FROM public.users WHERE email='priya@student.akoro.app') ORDER BY confidence;
