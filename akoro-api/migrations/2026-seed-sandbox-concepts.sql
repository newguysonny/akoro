-- =============================================================
-- 2026-seed-sandbox-concepts.sql  (demo group: the gate SANDBOX only)
-- D44: one test learner's agent knows Biology "Cells" as three CONCEPTS
-- (agent_knowledge rows keyed topic + subtopic), one of them long unreviewed,
-- so the gate can prove the per-concept forgetting curve and concept-led
-- review sessions. Idempotent (DO NOTHING on the concept key).
-- =============================================================
DO $$
DECLARE v_uid uuid; v_sa uuid;
BEGIN
  SELECT id INTO v_uid FROM public.users WHERE email = 'tester17@demo.akoro.app';
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT id INTO v_sa FROM edu.student_agents WHERE student_id = v_uid;
  IF v_sa IS NULL THEN RETURN; END IF;
  INSERT INTO edu.agent_knowledge (agent_id, student_id, topic, subject, subtopic, content, chunk_type,
                                   confidence, learned_confidence, learned_at, stability_days, times_seen, last_seen_at, priority)
  SELECT v_sa, v_uid, 'Cells', 'Biology', c.subtopic, c.content, 'taught',
         c.conf, c.conf, now() - make_interval(days => c.days), 45, 1, now() - make_interval(days => c.days), 'low'
  FROM (VALUES
    ('Cell wall',    'A plant cell has a rigid cell wall made of cellulose outside its membrane.', 0.85, 60),
    ('Nucleus',      'The nucleus holds the DNA and controls what the cell does.',                0.85, 1),
    ('Mitochondria', 'Mitochondria release energy from food in respiration.',                     0.80, 5)
  ) AS c(subtopic, content, conf, days)
  ON CONFLICT (agent_id, topic, subtopic) DO NOTHING;
END $$;
