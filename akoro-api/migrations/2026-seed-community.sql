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
  bt    RECORD;
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

    -- ── Battles + participants (each guarded by its own title, so a
    --     re-run tops up any state that's missing) ──────────────
    IF a1.id IS NOT NULL AND a2.id IS NOT NULL THEN
      FOR bt IN
        SELECT * FROM (VALUES
          ('Demo Battle · Chain Rule Gauntlet', 'live',      'medium', 100, 23, now(),                     7, 5, 70, 80),
          ('Demo Battle · Integration Masters', 'scheduled', 'medium', 100,  0, now() + interval '45 minutes', 0, 0, 100, 100),
          ('Demo Battle · WAEC Prep',           'completed', 'hard',   150,  0, now() - interval '2 hours', 9, 7, 100, 0)
        ) AS t(title, status, difficulty, xp, viewers, start, sa, sb, ha, hb)
      LOOP
        BEGIN
          SELECT id INTO bid FROM public.battles WHERE course_id = cid AND title = bt.title;
          IF bid IS NULL THEN
            INSERT INTO public.battles (course_id, battle_type, title, description, subject, difficulty, xp_prize, xp_pool, time_limit_seconds, total_questions, status, peak_viewers, scheduled_start, expires_at, created_by)
            SELECT cid, '1v1', bt.title, '1v1 battle', 'Further Mathematics', bt.difficulty, bt.xp, bt.xp, 600, 5, bt.status, bt.viewers, bt.start, now() + interval '1 day', c.instructor_id
            FROM public.courses c WHERE c.id = cid
            RETURNING id INTO bid;
            INSERT INTO public.battle_participants (battle_id, user_id, agent_id, role, score, hp) VALUES
              (bid, a1.user_id, a1.id, 'creator',  bt.sa, bt.ha),
              (bid, a2.user_id, a2.id, 'opponent', bt.sb, bt.hb);
          END IF;
          -- Seed the actual questions so the arena shows a question + options
          -- (without these there is nothing for the modal to render). Guarded
          -- separately so it also backfills battles seeded before this revision.
          IF bid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = bid) THEN
            INSERT INTO public.battle_questions (battle_id, question_order, question_text, options_json, correct_answer_index, topic, subject, xp_value, time_limit_seconds) VALUES
              (bid, 1, 'Derivative of ln(x)?',            '["x","1/x","e^x","ln(x)/x"]',                          1, 'Differentiation', 'Further Mathematics', 30, 15),
              (bid, 2, 'What is d/dx of sin(3x)?',        '["cos(3x)","3cos(3x)","-3cos(3x)","3sin(3x)"]',        1, 'Chain Rule',      'Further Mathematics', 35, 15),
              (bid, 3, 'Integrate: 3x^2 dx',              '["6x + C","x^3 + C","x^3","3x^3 + C"]',                 1, 'Integration',     'Further Mathematics', 30, 15),
              (bid, 4, 'lim(x -> 0) sin(x)/x = ?',        '["0","Infinity","1","Undefined"]',                     2, 'Limits',          'Further Mathematics', 35, 15),
              (bid, 5, 'What is d/dx of e^(2x)?',         '["e^(2x)","2e^x","2e^(2x)","e^x"]',                     2, 'Differentiation', 'Further Mathematics', 40, 15);
            UPDATE public.battles SET total_questions = 5 WHERE id = bid;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'battle "%" skipped for %: %', bt.title, cid, SQLERRM;
        END;
      END LOOP;
    END IF;

  END LOOP;

  -- ── One classroom demo battle: a teacher agent vs the whole class ──
  --     (so the modal's "TEACHER · vs N student agents · Qx/5" view has data)
  BEGIN
    SELECT id INTO cid FROM public.courses WHERE slug LIKE 'demo-fmaths-%' ORDER BY created_at NULLS LAST, id LIMIT 1;
    IF cid IS NOT NULL AND a1.id IS NOT NULL THEN
      SELECT id INTO bid FROM public.battles WHERE course_id = cid AND title = 'Demo Class Battle · Calculus Championship';
      IF bid IS NULL THEN
        INSERT INTO public.battles (course_id, battle_type, title, description, subject, difficulty, xp_prize, xp_pool, time_limit_seconds, total_questions, status, peak_viewers, expires_at, created_by)
        SELECT cid, 'classroom', 'Demo Class Battle · Calculus Championship', 'Teacher agent challenges the class', 'Further Mathematics', 'hard', 500, 500, 600, 5, 'live', 21, now() + interval '1 day', c.instructor_id
        FROM public.courses c WHERE c.id = cid
        RETURNING id INTO bid;
        -- Teacher agent
        INSERT INTO public.battle_participants (battle_id, user_id, agent_id, role, score, hp)
        VALUES (bid, a1.user_id, a1.id, 'teacher', 9, 64);
        -- Up to 6 student agents (any other agents, distinct users)
        INSERT INTO public.battle_participants (battle_id, user_id, agent_id, role, score, hp)
        SELECT bid, s.user_id, s.id, 'participant',
               (ARRAY[5,7,4,6,3,9])[s.rn], (ARRAY[85,70,90,78,94,62])[s.rn]
        FROM (
          SELECT ua.id, ua.user_id, row_number() OVER (ORDER BY ua.created_at NULLS LAST) AS rn
          FROM public.user_agents ua
          WHERE ua.id <> a1.id AND ua.user_id <> a1.user_id
        ) s
        WHERE s.rn <= 6;
      END IF;
      IF bid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = bid) THEN
        INSERT INTO public.battle_questions (battle_id, question_order, question_text, options_json, correct_answer_index, topic, subject, xp_value, time_limit_seconds) VALUES
          (bid, 1, 'Derivative of ln(x)?',            '["x","1/x","e^x","ln(x)/x"]',                          1, 'Differentiation', 'Further Mathematics', 30, 15),
          (bid, 2, 'What is d/dx of sin(3x)?',        '["cos(3x)","3cos(3x)","-3cos(3x)","3sin(3x)"]',        1, 'Chain Rule',      'Further Mathematics', 35, 15),
          (bid, 3, 'Integrate: 3x^2 dx',              '["6x + C","x^3 + C","x^3","3x^3 + C"]',                 1, 'Integration',     'Further Mathematics', 30, 15),
          (bid, 4, 'lim(x -> 0) sin(x)/x = ?',        '["0","Infinity","1","Undefined"]',                     2, 'Limits',          'Further Mathematics', 35, 15),
          (bid, 5, 'What is d/dx of e^(2x)?',         '["e^(2x)","2e^x","2e^(2x)","e^x"]',                     2, 'Differentiation', 'Further Mathematics', 40, 15);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'classroom demo battle skipped: %', SQLERRM;
  END;
END $$;
