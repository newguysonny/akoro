-- =============================================================
-- 2026-seed-agent-testers.sql
-- 50 demo learners (tester01 … tester50) with enough real data that EVERY
-- learner Agent Chat tool has something true to return — for the agent
-- console (/api/agent-console) and for hand testing in the learner app.
--
--   Login:     tester01@demo.akoro.app … tester50@demo.akoro.app
--   Password:  Password123!
--   Console:   AGENT_CONSOLE_LEARNERS=@tester01,…,@tester50
--
-- Cohorts (who is where decides scope=school/classmates, billing, leagues):
--   tester01-10  Akoro Demo Academy · JSS1    BECE
--   tester11-15  Akoro Demo Academy · JSS2    BECE
--   tester16-20  Akoro Demo Academy · JSS3    BECE
--   tester21-24  Akoro Demo Academy · SS1     WAEC
--   tester25-27  Akoro Demo Academy · SS2     WAEC
--   tester28-30  Akoro Demo Academy · SS3     WAEC
--   tester31-40  independent, "Lagos Model College" (school name only) JAMB
--   tester41-50  independent, no school                                 NECO
--   School testers' battle entry bills the SCHOOL coin account (topped up
--   here); independent testers bill their own.
--
-- Edge cases, on purpose (tests for gates and privacy):
--   tester05 hidden from search          tester06 visible to school only
--   tester08 accepts messages from nobody tester10 not open to challenges
--   tester12 off the leaderboards         tester04 has blocked tester03
--   tester07, tester33, tester48: 0 XP (fail min_xp)
--   tester35, tester49: 0 coins (fail coin entry; independent, so own wallet)
--   tester01-05: Full Autonomy on (01-02 level 2)
--
-- Every learner has: an agent, presence, coins, subject XP (all-time and
-- this week), courses, taught knowledge (some weak topics), learning
-- sessions, study notes, 3 chats with history, memories, tasks, goals, a
-- proposal, a suggestion, past-question practice, and (odd testers) a draft
-- blog. Between learners: buddies (active and pending), agent messages
-- (unanswered consults to reply to, unread answers), open challenge
-- requests, open revision circles, completed battles (rematch, history) and
-- scheduled battles with questions.
--
-- Idempotent. Rows are created once (guarded by email / natural keys /
-- NOT EXISTS). Time-relative rows are REFRESHED on every run, so a deploy
-- keeps the data testable: presence, this-week XP, request expiry, circle
-- and battle start times, proposal expiry.
-- =============================================================

DO $$
DECLARE
  v_pw      text := '$2b$10$HKzqNJTCBHeB0uWSWhf7PeLIOMrlEw2.9oYDI3vQPEs6WAl5Fo7KS'; -- Password123!
  v_school  uuid;
  v_names   text[] := ARRAY[
    'Adaeze Okafor','Bayo Adeleke','Chioma Nwosu','Dayo Ogunleye','Efe Omoregie',
    'Folake Adeyemi','Gbenga Olatunji','Hauwa Musa','Ikenna Eze','Jumoke Bakare',
    'Kemi Afolabi','Lanre Ojo','Maryam Bello','Nkechi Uche','Obinna Okonkwo',
    'Pelumi Akinola','Rukayat Salami','Sade Oyelaran','Temi Fashola','Uche Nnaji',
    'Victor Etuk','Wale Adebisi','Yinka Coker','Zara Abdullahi','Amaka Obi',
    'Bisi Lawal','Chinedu Agu','Dami Ige','Emeka Udeh','Fisayo Ola',
    'Ganiyu Shittu','Hadiza Garba','Ifeoma Chukwu','Jide Ogundipe','Kunle Aina',
    'Lola Ajayi','Mubarak Sani','Ngozi Ibe','Ope Makinde','Rotimi Dada',
    'Seun Babatunde','Tolu Ilori','Ugo Mba','Wunmi Fagbemi','Yusuf Danjuma',
    'Zainab Kolawole','Ayo Ogunbiyi','Bukola Ade','Chuka Onu','Dupe Alade'];
  v_agents  text[] := ARRAY[
    'Nova','Bolt','Sage','Pixel','Echo','Atlas','Orbit','Luna','Comet','Iris',
    'Zephyr','Quill','Ember','Vega','Rune','Spark','Nimbus','Onyx','Juno','Kite',
    'Blaze','Cosmo','Delta','Flint','Gizmo','Halo','Indigo','Jet','Koda','Lyric',
    'Mako','Nyx','Ozzy','Pluto','Quasar','Rio','Saber','Tango','Umbra','Volt',
    'Wren','Xeno','Yeti','Zest','Arrow','Bramble','Cipher','Dash','Fable','Glimmer'];
  v_emojis  text[] := ARRAY['🦁','🐯','🦊','🐼','🐨','🦉','🐧','🦅','🐢','🦋'];
  v_colors  text[] := ARRAY['#6C3BFF','#E8884A','#10B981','#3B82F6','#EF4444','#F59E0B','#8B5CF6','#14B8A6'];
  v_subjsets jsonb := '[
    ["Mathematics","Basic Science","English Language"],
    ["English Language","Social Studies","Civic Education"],
    ["Basic Science","Mathematics","Computer Studies"],
    ["Physics","Mathematics","Chemistry"],
    ["Biology","Chemistry","English Language"],
    ["Economics","Mathematics","Government"]]'::jsonb;
  v_topics  jsonb := '{
    "Mathematics":["Fractions","Algebraic expressions","Simultaneous equations","Quadratic equations","Indices"],
    "Basic Science":["Living things","Energy","Matter and its states","Simple machines","The human body"],
    "English Language":["Parts of speech","Comprehension","Essay writing","Concord","Figures of speech"],
    "Social Studies":["Culture","Family","Socialization","Community","Values"],
    "Civic Education":["Citizenship","Rule of law","Human rights","National values","Democracy"],
    "Computer Studies":["Computer hardware","Input devices","Software","Internet safety","Data processing"],
    "Physics":["Motion","Newton''s laws","Work and energy","Waves","Electricity"],
    "Chemistry":["Atomic structure","Chemical bonding","Mole concept","Acids and bases","Balancing equations"],
    "Biology":["Cell structure","Photosynthesis","Respiration","Genetics","Ecology"],
    "Economics":["Demand and supply","Elasticity","Production","Money and banking","Market structures"],
    "Government":["Constitution","Arms of government","Federalism","Elections","Political parties"]
  }'::jsonb;
  i         int;
  k         int;
  v_uid     uuid;
  v_agent   uuid;
  v_sa      uuid;
  v_room    uuid;
  v_mclass  uuid;
  v_cls     text;
  v_exam    text;
  v_level   text;
  v_schname text;
  v_subjs   text[];
  v_subj    text;
  v_topic   text;
  v_xp      int;
  v_conf    numeric;
  v_sess    uuid;
  v_first   text;
  v_acct    uuid;
  v_coins   bigint;
  v_course  uuid;
  v_monday  timestamptz := date_trunc('week', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos';
BEGIN
  SELECT id INTO v_school FROM public.school_profiles WHERE name = 'Akoro Demo Academy' LIMIT 1;
  IF v_school IS NULL THEN
    RAISE NOTICE 'Akoro Demo Academy not found — run 2026-seed-school.sql first. Skipping agent testers.';
    RETURN;
  END IF;

  FOR i IN 1..50 LOOP
    v_first := split_part(v_names[i], ' ', 1);
    -- cohort
    v_cls := CASE WHEN i <= 10 THEN 'JSS1' WHEN i <= 15 THEN 'JSS2' WHEN i <= 20 THEN 'JSS3'
                  WHEN i <= 24 THEN 'SS1' WHEN i <= 27 THEN 'SS2' WHEN i <= 30 THEN 'SS3' ELSE NULL END;
    v_exam := CASE WHEN i <= 20 THEN 'BECE' WHEN i <= 30 THEN 'WAEC' WHEN i <= 40 THEN 'JAMB' ELSE 'NECO' END;
    v_level := CASE WHEN i <= 20 THEN 'Junior Secondary' ELSE 'Senior Secondary' END;
    v_schname := CASE WHEN i <= 30 THEN 'Akoro Demo Academy' WHEN i <= 40 THEN 'Lagos Model College' ELSE NULL END;
    v_subjs := ARRAY(SELECT jsonb_array_elements_text(v_subjsets -> (CASE WHEN i <= 20 THEN i % 3 ELSE 3 + i % 3 END)));
    v_xp := CASE WHEN i IN (7, 33, 48) THEN 0 ELSE 150 + ((i * 397) % 2400) END;

    -- ── account ────────────────────────────────────────────────────────
    SELECT id INTO v_uid FROM public.users WHERE email = format('tester%s@demo.akoro.app', lpad(i::text, 2, '0'));
    IF v_uid IS NULL THEN
      INSERT INTO public.users (email, username, password_hash, full_name, role, is_active, avatar_emoji,
                                onboarding_completed, email_verified, city, country, school_name,
                                year_group, study_level, subjects)
      VALUES (format('tester%s@demo.akoro.app', lpad(i::text, 2, '0')), format('tester%s', lpad(i::text, 2, '0')),
              v_pw, v_names[i], 'student', true, v_emojis[1 + (i % 10)], true, true,
              CASE WHEN i % 3 = 0 THEN 'Abuja' WHEN i % 3 = 1 THEN 'Lagos' ELSE 'Port Harcourt' END, 'Nigeria',
              v_schname, COALESCE(v_cls, CASE WHEN i <= 40 THEN 'SS3' ELSE 'SS2' END), v_level, v_subjs)
      RETURNING id INTO v_uid;
    END IF;

    INSERT INTO public.user_settings (user_id, settings)
    VALUES (v_uid, '{"timezone":"Africa/Lagos"}'::jsonb)
    ON CONFLICT (user_id) DO NOTHING;

    -- ── agent ──────────────────────────────────────────────────────────
    INSERT INTO public.user_agents (user_id, agent_name, agent_emoji, agent_color, agent_bg, is_active,
                                    total_xp, level, exam_board, subjects, goal, year_group, study_level,
                                    total_sessions, total_turns, knowledge_score)
    VALUES (v_uid, v_agents[i], v_emojis[1 + ((i + 3) % 10)], v_colors[1 + (i % 8)], '#F4F0FF', true,
            v_xp, 1 + v_xp / 500, v_exam, v_subjs,
            format('Pass %s with strong grades in %s', v_exam, v_subjs[1]),
            COALESCE(v_cls, 'SS3'), v_level, 2 + i % 9, 20 + i * 3, 30 + (i * 7) % 60)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT id INTO v_agent FROM public.user_agents WHERE user_id = v_uid;

    -- ── school links (01-30) ───────────────────────────────────────────
    IF v_cls IS NOT NULL THEN
      SELECT id INTO v_room FROM public.classrooms WHERE school_id = v_school AND name = v_cls LIMIT 1;
      IF v_room IS NOT NULL THEN
        INSERT INTO public.classroom_students (classroom_id, user_id, status)
        VALUES (v_room, v_uid, 'active')
        ON CONFLICT (classroom_id, user_id) DO UPDATE SET status = 'active';
      END IF;
      SELECT id INTO v_mclass FROM mgmt.classes WHERE school_id = v_school AND name = v_cls LIMIT 1;
      IF NOT EXISTS (SELECT 1 FROM mgmt.students WHERE school_id = v_school AND user_id = v_uid) THEN
        INSERT INTO mgmt.students (school_id, admission_no, first_name, last_name, user_id, class_id, status, gender)
        VALUES (v_school, format('TST-%s', lpad(i::text, 4, '0')), v_first, split_part(v_names[i], ' ', 2),
                v_uid, v_mclass, 'active', CASE WHEN i % 2 = 0 THEN 'male' ELSE 'female' END)
        ON CONFLICT (school_id, admission_no) DO UPDATE SET user_id = EXCLUDED.user_id, class_id = EXCLUDED.class_id;
      END IF;
    END IF;

    -- ── network settings / presence (presence refreshed every run) ─────
    INSERT INTO edu.agent_network_settings (user_id, visibility, accept_messages, open_to_challenges,
                                            battle_times, battle_types, show_on_leaderboards, daily_subject)
    VALUES (v_uid,
            CASE i WHEN 5 THEN 'hidden' WHEN 6 THEN 'school' ELSE 'everyone' END,
            CASE i WHEN 8 THEN 'nobody' WHEN 9 THEN 'school' ELSE 'everyone' END,
            i <> 10,
            CASE WHEN i % 2 = 0 THEN ARRAY['evening','weekend'] ELSE ARRAY['afternoon'] END,
            CASE WHEN i % 3 = 0 THEN ARRAY['1v1','team'] ELSE ARRAY['1v1','open','review'] END,
            i <> 12,
            CASE WHEN i % 4 = 0 THEN v_subjs[1] ELSE NULL END)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO edu.learner_presence (user_id, last_seen_at, surface)
    VALUES (v_uid,
            CASE WHEN i % 4 = 0 THEN now() WHEN i % 4 = 1 THEN now() - interval '3 hours'
                 WHEN i % 4 = 2 THEN now() - interval '2 days' ELSE now() - interval '10 days' END,
            'learner_app')
    ON CONFLICT (user_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;

    IF i <= 5 THEN
      INSERT INTO edu.learner_agent_autonomy (user_id, enabled, level)
      VALUES (v_uid, true, CASE WHEN i <= 2 THEN 2 ELSE 1 END)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;

    -- ── coins (school testers bill the school; topped up below) ────────
    v_coins := CASE WHEN i IN (35, 49) THEN 0 ELSE 5000 END;
    INSERT INTO public.coin_accounts (owner_type, owner_id, balance)
    VALUES ('user', v_uid, v_coins)
    ON CONFLICT (owner_type, owner_id) DO UPDATE
      SET balance = CASE WHEN EXCLUDED.balance = 0 THEN 0 ELSE GREATEST(public.coin_accounts.balance, EXCLUDED.balance) END,
          updated_at = now()
    RETURNING id INTO v_acct;
    IF v_coins > 0 AND NOT EXISTS (SELECT 1 FROM public.coin_transactions WHERE account_id = v_acct AND type = 'grant') THEN
      INSERT INTO public.coin_transactions (account_id, delta, balance_after, type)
      VALUES (v_acct, v_coins, v_coins, 'grant');
    END IF;

    -- ── XP: all-time (xp_transactions feeds ranks) ─────────────────────
    IF v_xp > 0 THEN
      FOR k IN 1..array_length(v_subjs, 1) LOOP
        IF NOT EXISTS (SELECT 1 FROM public.xp_transactions
                        WHERE user_id = v_uid AND reason = 'seed_tester_xp' AND subject = v_subjs[k]) THEN
          INSERT INTO public.xp_transactions (user_id, reason, subject, amount, created_at)
          VALUES (v_uid, 'seed_tester_xp', v_subjs[k], GREATEST(10, v_xp / (k + 1)), now() - make_interval(days => 20 + k));
        END IF;
      END LOOP;
      -- this week (xp_ledger feeds the weekly league + buddy check-ins): refreshed weekly
      IF NOT EXISTS (SELECT 1 FROM public.xp_ledger WHERE user_id = v_uid AND source = 'seed_tester' AND created_at >= v_monday) THEN
        INSERT INTO public.xp_ledger (user_id, agent_id, amount, source, running_total, created_at)
        VALUES (v_uid, v_agent, 20 + (i * 37) % 280, 'seed_tester', v_xp,
                GREATEST(v_monday + interval '1 minute', now() - interval '5 minutes'));
      END IF;
    END IF;

    -- ── courses (check_progress) ───────────────────────────────────────
    FOR v_course IN
      SELECT id FROM public.courses
       WHERE slug = ANY (CASE WHEN i <= 30 THEN ARRAY['demo-academy-maths','demo-academy-english']
                              ELSE ARRAY['demo-physics-video','demo-chem-video','demo-maths-live'] END)
    LOOP
      INSERT INTO public.enrollments (user_id, course_id, status, progress)
      VALUES (v_uid, v_course, 'active', (i * 13 + length(v_course::text)) % 100)
      ON CONFLICT (user_id, course_id) DO NOTHING;
    END LOOP;

    -- ── what the agent has been taught (weak topics, knowledge map) ────
    INSERT INTO edu.student_agents (student_id, name, level, total_sessions, total_turns, knowledge_score, subjects_learned)
    VALUES (v_uid, v_agents[i], 1 + v_xp / 500, 2 + i % 9, 20 + i * 3, 30 + (i * 7) % 60, v_subjs)
    ON CONFLICT (student_id) DO NOTHING;
    SELECT id INTO v_sa FROM edu.student_agents WHERE student_id = v_uid;

    FOR k IN 1..array_length(v_subjs, 1) LOOP
      v_subj := v_subjs[k];
      FOR v_topic IN SELECT jsonb_array_elements_text(v_topics -> v_subj) LIMIT 4 LOOP
        -- spread 0.25 … 0.95 so every learner has weak (<0.5) and strong (≥0.55) topics
        v_conf := round((0.25 + ((abs(hashtext(v_uid::text || v_topic)) % 71) / 100.0))::numeric, 2);
        INSERT INTO edu.agent_knowledge (agent_id, student_id, topic, subject, content, chunk_type, confidence,
                                         times_seen, last_seen_at, priority, next_review_due, subtopic)
        VALUES (v_sa, v_uid, v_topic, v_subj,
                format('%s taught %s: the key ideas of %s in %s, with two worked examples.', v_first, v_agents[i], v_topic, v_subj),
                'taught', v_conf, 1 + (i + k) % 5, now() - make_interval(days => (i + k) % 14),
                CASE WHEN v_conf < 0.4 THEN 'high' WHEN v_conf < 0.6 THEN 'medium' ELSE 'low' END,
                now() + make_interval(days => (i + k) % 7) - interval '2 days', '')
        ON CONFLICT (agent_id, topic, subtopic) DO NOTHING;
        INSERT INTO edu.student_knowledge (student_id, agent_id, topic, subject, content, source, confidence, tags, subtopic)
        VALUES (v_uid, v_sa, v_topic, v_subj,
                format('My notes on %s (%s): definition, key formula or rule, and one example I got wrong before.', v_topic, v_subj),
                'session', v_conf, ARRAY[lower(v_subj)], '')
        ON CONFLICT (student_id, topic, subtopic) DO NOTHING;
      END LOOP;
    END LOOP;

    -- ── learning sessions (get_my_learning_sessions) ───────────────────
    IF NOT EXISTS (SELECT 1 FROM edu.adaptive_sessions WHERE student_id = v_uid) THEN
      FOR k IN 1..2 LOOP
        v_subj := v_subjs[k];
        v_topic := v_topics -> v_subj ->> (k - 1);
        INSERT INTO edu.adaptive_sessions (student_id, student_agent_id, topic, subject, status, current_phase,
                                           started_at, completed_at, subtopics)
        VALUES (v_uid, v_sa, v_topic, v_subj, CASE WHEN k = 1 THEN 'complete' ELSE 'active' END,
                CASE WHEN k = 1 THEN '5' ELSE '2' END,
                now() - make_interval(days => 6 - k * 2), CASE WHEN k = 1 THEN now() - interval '4 days' END,
                jsonb_build_array(v_topic || ' basics', v_topic || ' practice'))
        RETURNING id INTO v_sess;
        INSERT INTO edu.session_knowledge_delta (session_id, agent_id, student_id, topic, subject, concepts_learned, xp_earned, started_at, completed_at)
        VALUES (v_sess::text, v_sa, v_uid, v_topic, v_subj, ARRAY[v_topic || ' basics', v_topic || ' practice'], 25 + i % 30,
                now() - make_interval(days => 6 - k * 2), CASE WHEN k = 1 THEN now() - interval '4 days' END);
      END LOOP;
    END IF;

    -- ── chats with history (list_chats / read_chat / post_to_chat) ─────
    IF NOT EXISTS (SELECT 1 FROM public.chat_sessions WHERE user_id = v_uid) THEN
      FOR k IN 1..3 LOOP
        v_subj := v_subjs[k];
        v_topic := v_topics -> v_subj ->> ((i + k) % 5);
        INSERT INTO public.chat_sessions (user_id, title, created_at, updated_at, last_message_at)
        VALUES (v_uid, format('%s — %s', v_subj, v_topic), now() - make_interval(days => k * 3),
                now() - make_interval(days => k * 3 - 1), now() - make_interval(days => k * 3 - 1))
        RETURNING id INTO v_sess;
        INSERT INTO public.chat_messages (session_id, user_id, role, text, created_at) VALUES
          (v_sess, v_uid, 'user',  format('Can you help me understand %s? I keep getting it wrong.', v_topic), now() - make_interval(days => k * 3)),
          (v_sess, v_uid, 'agent', format('Of course, %s! %s in %s comes down to three ideas. Let''s start with the first and I''ll check your answer after each step.', v_first, v_topic, v_subj), now() - make_interval(days => k * 3) + interval '1 minute'),
          (v_sess, v_uid, 'user',  'Okay, give me a practice question.', now() - make_interval(days => k * 3) + interval '3 minutes'),
          (v_sess, v_uid, 'agent', format('Here''s one on %s. Take your time — then tell me how you got your answer. Next time we can revise it with past questions.', v_topic), now() - make_interval(days => k * 3) + interval '4 minutes');
        IF k = 1 THEN
          INSERT INTO edu.learner_agent_memories (user_id, chat_session_id, agent_session_id, agent_turn_id, kind, content, subject, topic, status)
          VALUES
            (v_uid, v_sess, 'seed-tester', format('seed-%s-pref', i), 'study_preference',
             format('%s prefers short worked examples and a practice question after each step.', v_first), v_subj, v_topic, 'active'),
            (v_uid, v_sess, 'seed-tester', format('seed-%s-goal', i), 'learner_goal',
             format('%s wants to pass %s with strong grades in %s.', v_first, v_exam, v_subjs[1]), v_subjs[1], NULL, 'active'),
            (v_uid, v_sess, 'seed-tester', format('seed-%s-sum', i), 'learning_summary',
             format('Covered %s in %s; still unsure about applying it to word problems.', v_topic, v_subj), v_subj, v_topic, 'active')
          ON CONFLICT DO NOTHING;
        END IF;
      END LOOP;
    END IF;

    -- ── tasks / goals / suggestions / proposals ────────────────────────
    IF NOT EXISTS (SELECT 1 FROM public.tasks WHERE creator_id = v_uid AND payload ->> 'seed' = 'tester') THEN
      INSERT INTO public.tasks (creator_id, agent_id, title, description, priority, status, task_type, payload, due_at, timezone)
      VALUES
        (v_uid, v_agent, format('Revise %s', v_topics -> v_subjs[1] ->> 0), 'Go through the notes, then 10 practice questions.',
         'high', 'pending', 'general', jsonb_build_object('seed', 'tester', 'course', v_subjs[1], 'due', 'In 2 days'),
         now() + interval '2 days', 'Africa/Lagos'),
        (v_uid, v_agent, format('%s past questions — 2019 paper', v_exam), NULL,
         'medium', 'pending', 'general', jsonb_build_object('seed', 'tester', 'course', v_subjs[2]), NULL, 'Africa/Lagos'),
        (v_uid, v_agent, 'Read chapter 3 summary', NULL,
         'low', 'done', 'general', jsonb_build_object('seed', 'tester'), now() - interval '1 day', 'Africa/Lagos');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM edu.learner_goals WHERE user_id = v_uid) THEN
      INSERT INTO edu.learner_goals (user_id, title, category, metric, target_date, exam, status, source, progress_note)
      VALUES
        (v_uid, format('Score A in %s %s', v_exam, v_subjs[1]), 'exam', 'grade A', (now() + interval '120 days')::date, v_exam, 'active', 'learner', 'Two topics done, three to go'),
        (v_uid, format('Practise %s 4 times a week', v_subjs[2]), 'habit', '4 sessions / week', (now() + interval '30 days')::date, NULL, 'active', 'agent', NULL),
        (v_uid, 'Finish the maths course', 'course', '100% progress', NULL, NULL, CASE WHEN i % 5 = 0 THEN 'achieved' ELSE 'paused' END, 'learner', NULL);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.agent_suggestions WHERE user_id = v_uid) THEN
      INSERT INTO public.agent_suggestions (user_id, agent_id, kind, title, rationale, source, status)
      VALUES (v_uid, v_agent, CASE i % 3 WHEN 0 THEN 'task' WHEN 1 THEN 'goal' ELSE 'conversation' END,
              format('A 15-minute %s warm-up before class', v_subjs[1]),
              'Your weakest topics are all in this subject — short daily practice helps most.', 'chat', 'open');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM edu.agent_proposals WHERE user_id = v_uid AND payload ->> 'seed' = 'tester') THEN
      INSERT INTO edu.agent_proposals (user_id, kind, title, rationale, payload, status, source)
      VALUES (v_uid, 'practice', format('Practice session: %s', v_topics -> v_subjs[1] ->> 2),
              'Confidence dropped on this topic last week.',
              jsonb_build_object('seed', 'tester', 'subject', v_subjs[1]), 'proposed', 'cycle');
    END IF;
    UPDATE edu.agent_proposals SET expires_at = now() + interval '7 days'
     WHERE user_id = v_uid AND status = 'proposed' AND payload ->> 'seed' = 'tester';

    -- ── past-question practice ─────────────────────────────────────────
    IF NOT EXISTS (SELECT 1 FROM edu.past_question_attempts WHERE user_id = v_uid) THEN
      INSERT INTO edu.past_question_attempts (user_id, exam, subject, year, source, attempted, correct, created_at)
      VALUES
        (v_uid, v_exam, v_subjs[1], 2019, 'practice', 20, 8 + i % 12, now() - interval '6 days'),
        (v_uid, v_exam, v_subjs[2], 2021, 'practice', 15, 5 + i % 10, now() - interval '2 days'),
        (v_uid, v_exam, v_subjs[1], 2022, 'agent', 10, 4 + i % 6, now() - interval '1 day');
    END IF;

    -- ── a draft blog (odd testers) ─────────────────────────────────────
    IF i % 2 = 1 AND NOT EXISTS (SELECT 1 FROM edu.blogs WHERE user_id = v_uid) THEN
      INSERT INTO edu.blogs (user_id, title, body, status)
      VALUES (v_uid, format('How I finally understood %s', v_topics -> v_subjs[1] ->> 0),
              format('I used to find %s confusing. Here is what worked for me: break it into steps, teach it to my agent, then test myself with past questions.', v_topics -> v_subjs[1] ->> 0),
              'draft');
    END IF;
  END LOOP;

  -- School testers' battle entry bills the school account.
  INSERT INTO public.coin_accounts (owner_type, owner_id, balance)
  VALUES ('school', v_school, 200000)
  ON CONFLICT (owner_type, owner_id) DO UPDATE SET balance = GREATEST(public.coin_accounts.balance, 200000), updated_at = now();

  -- tester04 has blocked tester03
  INSERT INTO edu.agent_blocks (blocker_id, blocked_id)
  SELECT a.id, b.id FROM public.users a, public.users b
   WHERE a.username = 'tester04' AND b.username = 'tester03'
  ON CONFLICT DO NOTHING;
END $$;

-- ── Between learners ──────────────────────────────────────────────────────
-- A tiny lookup so the pair rows below read by username.
CREATE OR REPLACE FUNCTION pg_temp.tid(u text) RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT id FROM public.users WHERE username = u $$;

DO $$
DECLARE
  r       record;
  v_b     uuid;
  v_room  uuid;
  v_ca    uuid;
  v_cb    uuid;
  v_course uuid;
  v_q     int;
BEGIN
  IF pg_temp.tid('tester01') IS NULL THEN RETURN; END IF;

  -- Study buddies: active pairs and pending requests (to accept / decline).
  FOR r IN SELECT * FROM (VALUES
      ('tester01','tester02','active','Mathematics','BECE'),
      ('tester03','tester11','active','Basic Science','BECE'),
      ('tester21','tester22','active','Physics','WAEC'),
      ('tester31','tester32','active','Chemistry','JAMB'),
      ('tester13','tester01','pending','English Language','BECE'),
      ('tester41','tester31','pending','Economics','JAMB'),
      ('tester17','tester02','pending','Mathematics','BECE')) AS t(a, b, st, subj, ex)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM edu.study_buddies
                    WHERE LEAST(requester_id, buddy_id) = LEAST(pg_temp.tid(r.a), pg_temp.tid(r.b))
                      AND GREATEST(requester_id, buddy_id) = GREATEST(pg_temp.tid(r.a), pg_temp.tid(r.b))) THEN
      INSERT INTO edu.study_buddies (requester_id, buddy_id, goal, subject, exam, status, accepted_at, last_checkin_at, next_checkin_at)
      VALUES (pg_temp.tid(r.a), pg_temp.tid(r.b), format('Revise %s together for %s', r.subj, r.ex), r.subj, r.ex, r.st,
              CASE WHEN r.st = 'active' THEN now() - interval '5 days' END,
              CASE WHEN r.st = 'active' THEN now() - interval '2 days' END,
              CASE WHEN r.st = 'active' THEN now() + interval '1 day' END);
    END IF;
  END LOOP;

  -- Agent messages: consults waiting for a reply, answers not yet read,
  -- suggestions and invites — for check_agent_inbox / reply_to_agent.
  IF NOT EXISTS (SELECT 1 FROM edu.agent_messages WHERE from_user = pg_temp.tid('tester02') AND to_user = pg_temp.tid('tester01')) THEN
    INSERT INTO edu.agent_messages (from_user, to_user, kind, subject, topic, body, status, created_at) VALUES
      (pg_temp.tid('tester02'), pg_temp.tid('tester01'), 'consult', 'Mathematics', 'Fractions',
       'How do you add fractions with different denominators? My agent keeps mixing it up.', 'pending', now() - interval '3 hours'),
      (pg_temp.tid('tester11'), pg_temp.tid('tester01'), 'consult', 'Basic Science', 'Energy',
       'What is the difference between kinetic and potential energy, with an example?', 'pending', now() - interval '1 day'),
      (pg_temp.tid('tester32'), pg_temp.tid('tester31'), 'consult', 'Chemistry', 'Mole concept',
       'Any trick for mole calculations? I always forget which formula to use.', 'pending', now() - interval '5 hours'),
      (pg_temp.tid('tester22'), pg_temp.tid('tester21'), 'consult', 'Physics', 'Motion',
       'How do I pick the right equation of motion for a question?', 'pending', now() - interval '2 hours'),
      (pg_temp.tid('tester03'), pg_temp.tid('tester01'), 'suggestion', 'Basic Science', NULL,
       'Our agents could revise Living things together this week.', 'delivered', now() - interval '2 days'),
      (pg_temp.tid('tester15'), pg_temp.tid('tester01'), 'invite', 'Mathematics', NULL,
       'Join my revision circle on Indices on Saturday?', 'delivered', now() - interval '6 hours'),
      (pg_temp.tid('tester02'), pg_temp.tid('tester01'), 'buddy_checkin', 'Mathematics', NULL,
       'Check-in: I did 20 fraction questions this week — how about you?', 'read', now() - interval '3 days');
    -- answers waiting to be read by the asker
    INSERT INTO edu.agent_messages (from_user, to_user, kind, subject, topic, body, answer, answer_source, status, created_at, answered_at)
    VALUES
      (pg_temp.tid('tester01'), pg_temp.tid('tester02'), 'consult', 'English Language', 'Concord',
       'What is the rule for "either… or" subject–verb agreement?',
       'The verb agrees with the subject closest to it: "Either the teacher or the students ARE…"', 'taught', 'answered',
       now() - interval '1 day', now() - interval '20 hours'),
      (pg_temp.tid('tester31'), pg_temp.tid('tester33'), 'consult', 'Physics', 'Waves',
       'Which waves need a medium to travel?',
       'Mechanical waves (sound, water waves) need a medium; electromagnetic waves (light) do not.', 'learner', 'answered',
       now() - interval '2 days', now() - interval '1 day');
  END IF;

  -- Open challenge requests (search / accept / cancel). Expiry refreshed every run.
  FOR r IN SELECT * FROM (VALUES
      ('tester02','1v1','Fractions face-off','Mathematics','Fractions','BECE','everyone',2,10,10,0),
      ('tester11','open','Basic Science group quiz','Basic Science','Energy','BECE','school',6,12,15,0),
      ('tester14','team','English 2v2','English Language','Concord','BECE','everyone',4,10,10,0),
      ('tester16','1v1','Algebra duel','Mathematics','Algebraic expressions','BECE','classmates',2,8,20,300),
      ('tester21','1v1','Newton''s laws sprint','Physics','Newton''s laws','WAEC','everyone',2,10,10,0),
      ('tester23','open','Chemistry bonding battle','Chemistry','Chemical bonding','WAEC','school',5,10,12,0),
      ('tester26','1v1','Biology cell showdown','Biology','Cell structure','WAEC','everyone',2,10,25,800),
      ('tester32','1v1','JAMB Chemistry warm-up','Chemistry','Mole concept','JAMB','everyone',2,15,10,0),
      ('tester34','team','Economics team battle','Economics','Demand and supply','JAMB','everyone',4,12,10,0),
      ('tester38','open','Physics open room','Physics','Electricity','JAMB','everyone',8,10,5,0),
      ('tester42','1v1','Government quickfire','Government','Federalism','NECO','everyone',2,10,10,0),
      ('tester45','1v1','Maths high-stakes','Mathematics','Quadratic equations','NECO','everyone',2,10,40,1500)) AS t(who, bt, title, subj, topic, ex, scope, maxp, nq, hp, minxp)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM edu.challenge_requests WHERE created_by = pg_temp.tid(r.who) AND title = r.title) THEN
      INSERT INTO edu.challenge_requests (created_by, battle_type, title, subject, topic, exam, difficulty, total_questions,
                                          max_players, scope, min_xp, status, expires_at, hp_per_miss, note, scheduled_for)
      VALUES (pg_temp.tid(r.who), r.bt, r.title, r.subj, r.topic, r.ex, 'intermediate', r.nq, r.maxp, r.scope,
              NULLIF(r.minxp, 0), 'open', now() + interval '14 days', r.hp, 'seed:tester',
              CASE WHEN r.bt = '1v1' THEN NULL ELSE now() + interval '2 days' END);
    END IF;
  END LOOP;
  UPDATE edu.challenge_requests
     SET expires_at = now() + interval '14 days',
         scheduled_for = CASE WHEN scheduled_for IS NULL THEN NULL ELSE now() + interval '2 days' END
   WHERE note = 'seed:tester' AND status = 'open';

  -- Open revision circles (search / join / leave). Start time kept in the future.
  FOR r IN SELECT * FROM (VALUES
      ('tester15','Indices circle','Mathematics','Indices','BECE',5, ARRAY['tester15','tester12']),
      ('tester24','Organic chemistry circle','Chemistry','Balancing equations','WAEC',4, ARRAY['tester24','tester25','tester27']),
      ('tester36','JAMB English circle','English Language','Comprehension','JAMB',6, ARRAY['tester36','tester37'])) AS t(who, title, subj, topic, ex, maxm, members)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM edu.revision_circles WHERE created_by = pg_temp.tid(r.who) AND title = r.title) THEN
      INSERT INTO edu.revision_circles (created_by, title, exam, subject, topic, max_members, scheduled_for, status)
      VALUES (pg_temp.tid(r.who), r.title, r.ex, r.subj, r.topic, r.maxm, now() + interval '3 days', 'open')
      RETURNING id INTO v_b;
      INSERT INTO edu.revision_circle_members (circle_id, user_id)
      SELECT v_b, pg_temp.tid(m) FROM unnest(r.members) m
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  UPDATE edu.revision_circles c SET scheduled_for = now() + interval '3 days'
   WHERE status IN ('open', 'full')
     AND created_by IN (SELECT id FROM public.users WHERE username LIKE 'tester__');

  -- Battles: completed 1v1s (history, rematch) and scheduled ones with
  -- questions (find_battles). Scheduled starts are kept 5 days ahead.
  FOR r IN SELECT * FROM (VALUES
      ('tester01','tester02','Fractions rematch bait','Mathematics','Fractions','completed', 'JSS1'),
      ('tester03','tester04','Living things duel','Basic Science','Living things','completed','JSS1'),
      ('tester11','tester12','Social studies sprint','Social Studies','Culture','completed','JSS2'),
      ('tester21','tester22','Motion masters','Physics','Motion','completed','SS1'),
      ('tester31','tester34','Mole concept clash','Chemistry','Mole concept','completed', NULL),
      ('tester41','tester43','Demand and supply duel','Economics','Demand and supply','completed', NULL),
      ('tester05','tester06','Scheduled: Energy battle','Basic Science','Energy','scheduled','JSS1'),
      ('tester25','tester26','Scheduled: Photosynthesis battle','Biology','Photosynthesis','scheduled','SS2'),
      ('tester36','tester39','Scheduled: Electricity battle','Physics','Electricity','scheduled', NULL)) AS t(a, b, title, subj, topic, st, room)
  LOOP
    SELECT id INTO v_ca FROM public.user_agents WHERE user_id = pg_temp.tid(r.a);
    SELECT id INTO v_cb FROM public.user_agents WHERE user_id = pg_temp.tid(r.b);
    IF v_ca IS NULL OR v_cb IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.battles WHERE title = r.title AND created_by = pg_temp.tid(r.a)) THEN
      v_room := NULL; v_course := NULL;
      IF r.room IS NOT NULL THEN
        SELECT c.id INTO v_room FROM public.classrooms c JOIN public.school_profiles s ON s.id = c.school_id
         WHERE s.name = 'Akoro Demo Academy' AND c.name = r.room LIMIT 1;
      END IF;
      IF v_room IS NULL THEN SELECT id INTO v_course FROM public.courses WHERE slug = 'demo-physics-video'; END IF;
      IF v_room IS NULL AND v_course IS NULL THEN CONTINUE; END IF;
      INSERT INTO public.battles (battle_type, title, subject, topic, difficulty, total_questions, status, created_by,
                                  classroom_id, course_id, max_participants, total_participants, hp_per_miss, xp_prize, xp_pool,
                                  scheduled_start, actual_start, actual_end, duration_seconds)
      VALUES ('1v1', r.title, r.subj, r.topic, 'intermediate', 5, r.st, pg_temp.tid(r.a), v_room, v_course, 2, 2, 10, 100, 100,
              CASE WHEN r.st = 'scheduled' THEN now() + interval '5 days' ELSE now() - interval '4 days' END,
              CASE WHEN r.st = 'completed' THEN now() - interval '4 days' END,
              CASE WHEN r.st = 'completed' THEN now() - interval '4 days' + interval '6 minutes' END,
              CASE WHEN r.st = 'completed' THEN 360 END)
      RETURNING id INTO v_b;
      INSERT INTO public.battle_participants (battle_id, user_id, agent_id, role, score, hp, correct_answers, wrong_answers,
                                              is_winner, final_rank, xp_earned, joined_at)
      VALUES
        (v_b, pg_temp.tid(r.a), v_ca, 'creator',
         CASE WHEN r.st = 'completed' THEN 400 ELSE 0 END, CASE WHEN r.st = 'completed' THEN 90 ELSE 100 END,
         CASE WHEN r.st = 'completed' THEN 4 ELSE 0 END, CASE WHEN r.st = 'completed' THEN 1 ELSE 0 END,
         r.st = 'completed', CASE WHEN r.st = 'completed' THEN 1 END, CASE WHEN r.st = 'completed' THEN 80 ELSE 0 END,
         now() - interval '4 days'),
        (v_b, pg_temp.tid(r.b), v_cb, 'opponent',
         CASE WHEN r.st = 'completed' THEN 300 ELSE 0 END, CASE WHEN r.st = 'completed' THEN 80 ELSE 100 END,
         CASE WHEN r.st = 'completed' THEN 3 ELSE 0 END, CASE WHEN r.st = 'completed' THEN 2 ELSE 0 END,
         false, CASE WHEN r.st = 'completed' THEN 2 END, CASE WHEN r.st = 'completed' THEN 30 ELSE 0 END,
         now() - interval '4 days')
      ON CONFLICT (battle_id, user_id) DO NOTHING;
      FOR v_q IN 1..5 LOOP
        INSERT INTO public.battle_questions (battle_id, question_order, question_text, options_json, correct_answer_index)
        VALUES (v_b, v_q, format('%s question %s on %s: which statement is correct?', r.subj, v_q, r.topic),
                json_build_array(format('The correct fact about %s', r.topic), 'A common misconception',
                                 'An unrelated statement', 'None of the above')::text, 0);
      END LOOP;
    END IF;
  END LOOP;
  UPDATE public.battles SET scheduled_start = now() + interval '5 days'
   WHERE status = 'scheduled' AND title LIKE 'Scheduled: %'
     AND created_by IN (SELECT id FROM public.users WHERE username LIKE 'tester__');
END $$;

-- ── Rebuild the app-managed leaderboard scopes (the ranking job also does
-- this every 15 minutes) so the testers rank immediately. ─────────────────
DELETE FROM public.xp_leaderboard WHERE scope IN ('global', 'classroom', 'subject');

INSERT INTO public.xp_leaderboard (user_id, scope, total_xp, rank, updated_at)
SELECT user_id, 'global', SUM(amount), rank() OVER (ORDER BY SUM(amount) DESC), now()
FROM public.xp_transactions GROUP BY user_id;

INSERT INTO public.xp_leaderboard (user_id, scope, classroom_id, scope_ref_id, total_xp, rank, updated_at)
SELECT cs.user_id, 'classroom', cs.classroom_id, cs.classroom_id, g.total_xp,
       rank() OVER (PARTITION BY cs.classroom_id ORDER BY g.total_xp DESC), now()
FROM public.classroom_students cs
JOIN (SELECT user_id, SUM(amount) AS total_xp FROM public.xp_transactions GROUP BY user_id) g ON g.user_id = cs.user_id
WHERE cs.status = 'active';

INSERT INTO public.xp_leaderboard (user_id, scope, subject, total_xp, rank, updated_at)
SELECT user_id, 'subject', subject, SUM(amount), rank() OVER (PARTITION BY subject ORDER BY SUM(amount) DESC), now()
FROM public.xp_transactions WHERE subject IS NOT NULL GROUP BY user_id, subject;
