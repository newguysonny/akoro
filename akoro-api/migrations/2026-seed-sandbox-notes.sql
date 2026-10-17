-- =============================================================
-- 2026-seed-sandbox-notes.sql  (demo group: the gate SANDBOX only)
-- D45: the Agent Check battle answers ONLY from the learner's notes
-- (edu.student_knowledge). tester17 gets real Biology notes on cells, so the
-- gate's studyprep.agent_check_battle can run a check its agent can answer
-- from. Found by the notes search's word match (no embedding needed).
-- Idempotent (DO NOTHING on the note key).
-- =============================================================
DO $$
DECLARE v_uid uuid; v_sa uuid;
BEGIN
  SELECT id INTO v_uid FROM public.users WHERE email = 'tester17@demo.akoro.app';
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT id INTO v_sa FROM edu.student_agents WHERE student_id = v_uid;
  IF v_sa IS NULL THEN RETURN; END IF;
  INSERT INTO edu.student_knowledge (student_id, agent_id, topic, subject, content, source, confidence, tags, subtopic)
  SELECT v_uid, v_sa, 'Cells', 'Biology', n.content, 'session', 0.85, ARRAY['biology'], n.subtopic
  FROM (VALUES
    ('Cell wall',      'Plant cells have a rigid cell wall made of cellulose outside the cell membrane. The cell wall gives the cell its shape and stops it bursting when water enters by osmosis. Animal cells have no cell wall.'),
    ('Nucleus',        'The nucleus is the control centre of the cell. It contains chromosomes made of DNA, which carry the instructions for making proteins. It is surrounded by a nuclear membrane.'),
    ('Mitochondria',   'Mitochondria are where aerobic respiration happens in the cell. They release energy from glucose. Muscle cells and other active cells have many mitochondria.'),
    ('Cell membrane',  'The cell membrane surrounds the cytoplasm and controls what enters and leaves the cell. It is partially permeable.'),
    ('Chloroplasts',   'Chloroplasts are found in plant cells, mostly in the leaves. They contain chlorophyll, which absorbs light energy for photosynthesis.')
  ) AS n(subtopic, content)
  ON CONFLICT (student_id, topic, subtopic) DO NOTHING;
END $$;
