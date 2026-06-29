-- =============================================================
-- 2026-seed-community.sql
-- Seeds real community data (peer-revision live sessions + agent battles)
-- for the demo courses so the course page's Battles & Peer Revision
-- sections show real data from the DB.
--
-- Resilient: per-section exception guards mean a schema mismatch in one
-- part won't abort the rest. Idempotent (guarded by title markers).
-- Run after 2026-seed-demo-course.sql in Supabase SQL Editor.
-- =============================================================

DO $$
DECLARE
  crs   RECORD;
  cid   uuid;
  a1    RECORD;
  a2    RECORD;
  bid   uuid;
BEGIN
  -- ── Ensure every instructor has an agent (so battles have participants) ──
  BEGIN
    INSERT INTO public.user_agents (user_id, agent_name, agent_emoji, agent_color, agent_bg, is_active)
    SELECT u.id,
           'Agent ' || COALESCE(NULLIF(u.username, ''), left(u.id::text, 6)),
           (ARRAY['🤖','🔮','⚡','🌀','✨','🔺','🌙','💎'])[1 + (abs(hashtext(u.id::text)) % 8)],
           (ARRAY['#6C3BFF','#7C3AED','#D97706','#059669','#2563EB','#9333EA','#EC4899','#0EA5E9'])[1 + (abs(hashtext(u.id::text)) % 8)],
           '#EEE9FF', true
    FROM public.users u
    WHERE u.role IN ('instructor','admin')
      AND NOT EXISTS (SELECT 1 FROM public.user_agents ua WHERE ua.user_id = u.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'user_agents seed skipped: %', SQLERRM;
  END;

  -- Two distinct agents to act as battle participants (global pick).
  SELECT id, user_id, agent_name, agent_emoji, agent_color INTO a1
    FROM public.user_agents ORDER BY created_at NULLS LAST LIMIT 1;
  SELECT id, user_id, agent_name, agent_emoji, agent_color INTO a2
    FROM public.user_agents WHERE id <> COALESCE(a1.id, '00000000-0000-0000-0000-000000000000')
    ORDER BY created_at NULLS LAST LIMIT 1;

  FOR crs IN SELECT id FROM public.courses WHERE slug LIKE 'demo-fmaths-%' LOOP
    cid := crs.id;

    -- ── Peer revisions (live_sessions) ────────────────────────
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.live_sessions WHERE course_id = cid AND title LIKE 'Peer Revision%') THEN
        INSERT INTO public.live_sessions (course_id, instructor_id, title, topic, subject, session_type, platform, scheduled_start, max_participants, current_participants, status)
        SELECT cid, c.instructor_id, v.title, v.topic, 'Further Mathematics', 'live', v.platform, v.start, v.maxp, v.cur, v.status
        FROM public.courses c, (VALUES
          ('Peer Revision · Chain Rule deep-dive', 'Chain Rule',  'meet', now(),                    12, 8, 'live'),
          ('Peer Revision · Integration Q&A',      'Integration', 'zoom', now() + interval '1 day',  10, 3, 'scheduled'),
          ('Peer Revision · WAEC Past Papers',     'Exam prep',   'zoom', now() + interval '3 days', 20, 0, 'scheduled')
        ) AS v(title, topic, platform, start, maxp, cur, status)
        WHERE c.id = cid;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'revisions seed skipped for %: %', cid, SQLERRM;
    END;

    -- ── Battles + participants ────────────────────────────────
    BEGIN
      IF a1.id IS NOT NULL AND a2.id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.battles WHERE course_id = cid AND title LIKE 'Demo Battle%') THEN

        -- live battle
        INSERT INTO public.battles (course_id, battle_type, title, description, subject, difficulty, xp_prize, xp_pool, time_limit_seconds, status, peak_viewers, scheduled_start, expires_at, created_by)
        SELECT cid, '1v1', 'Demo Battle · Chain Rule Gauntlet', '1v1 calculus battle', 'Further Mathematics', 'medium', 100, 100, 600, 'active', 23, now(), now() + interval '1 day', c.instructor_id
        FROM public.courses c WHERE c.id = cid
        RETURNING id INTO bid;
        INSERT INTO public.battle_participants (battle_id, user_id, agent_id, role, score, hp) VALUES
          (bid, a1.user_id, a1.id, 'creator',  7, 70),
          (bid, a2.user_id, a2.id, 'opponent', 5, 80);

        -- scheduled (upcoming) battle
        INSERT INTO public.battles (course_id, battle_type, title, description, subject, difficulty, xp_prize, xp_pool, time_limit_seconds, status, peak_viewers, scheduled_start, expires_at, created_by)
        SELECT cid, '1v1', 'Demo Battle · Integration Masters', '1v1 integration battle', 'Further Mathematics', 'medium', 100, 100, 600, 'scheduled', 0, now() + interval '45 minutes', now() + interval '1 day', c.instructor_id
        FROM public.courses c WHERE c.id = cid
        RETURNING id INTO bid;
        INSERT INTO public.battle_participants (battle_id, user_id, agent_id, role, score, hp) VALUES
          (bid, a1.user_id, a1.id, 'creator',  0, 100),
          (bid, a2.user_id, a2.id, 'opponent', 0, 100);

        -- completed battle
        INSERT INTO public.battles (course_id, battle_type, title, description, subject, difficulty, xp_prize, xp_pool, time_limit_seconds, status, peak_viewers, scheduled_start, expires_at, created_by)
        SELECT cid, '1v1', 'Demo Battle · WAEC Prep', '1v1 exam-prep battle', 'Further Mathematics', 'hard', 150, 150, 600, 'completed', 0, now() - interval '2 hours', now() + interval '1 day', c.instructor_id
        FROM public.courses c WHERE c.id = cid
        RETURNING id INTO bid;
        INSERT INTO public.battle_participants (battle_id, user_id, agent_id, role, score, hp) VALUES
          (bid, a1.user_id, a1.id, 'creator',  9, 100),
          (bid, a2.user_id, a2.id, 'opponent', 7, 0);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'battles seed skipped for %: %', cid, SQLERRM;
    END;

  END LOOP;
END $$;
