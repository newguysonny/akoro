-- =============================================================
-- 2026-seed-ncee-2017.sql
-- First real paper in the bank: NCEE 2017 Paper I (Achievement Test).
--
-- Transcribed from the scanned NECO paper. The scan carries NO official answer
-- key, so every answer here is DERIVED — the maths answers are objectively
-- checkable, the comprehension answers are read off the passage. That is
-- recorded in the paper's meta so nobody later mistakes them for NECO's own
-- marking scheme.
--
-- This is a starter slice (Mathematics 1-8, English comprehension 1-2), enough
-- to exercise search, practice and agent grounding end to end. The rest of the
-- paper goes in through the vision ingest at
-- POST /api/past-questions/papers/:id/ingest.
--
-- Idempotent: guarded on (exam, year, title) and question number.
-- =============================================================

DO $$
DECLARE
  v_paper uuid;
  v_maths uuid;
  v_eng   uuid;
  v_pass  uuid;
BEGIN
  SELECT id INTO v_paper FROM edu.past_papers
   WHERE exam_slug = 'ncee' AND year = 2017 AND title = 'Paper I — Achievement Test';

  IF v_paper IS NULL THEN
    INSERT INTO edu.past_papers (exam_slug, year, title, paper_code, variant, duration_min, page_count, status, meta)
    VALUES ('ncee', 2017, 'Paper I — Achievement Test', 'Paper I', 'English and Mathematics', 130, 38, 'published',
      jsonb_build_object(
        'body', 'National Examinations Council (NECO), Minna',
        'parts', jsonb_build_array('Part A: Mathematics and General Science', 'Part B: English and Social Studies'),
        'question_counts', jsonb_build_object('mathematics_and_science', 50, 'english_and_social_studies', 60),
        'timing', '65 minutes per paper',
        'answer_source', 'derived — the scanned paper contains no official marking scheme'))
    RETURNING id INTO v_paper;
  END IF;

  -- ── Sections ──────────────────────────────────────────────
  SELECT id INTO v_maths FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'Mathematics';
  IF v_maths IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part A', 'Mathematics', 'Mathematics',
            'Answer all questions by choosing the most appropriate of the options lettered A – E.', 1)
    RETURNING id INTO v_maths;
  END IF;

  SELECT id INTO v_eng FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'English — Comprehension';
  IF v_eng IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part B', 'English — Comprehension', 'English Language',
            'Read the passages below carefully and answer the questions that follow by choosing the most appropriate of the options lettered A – E.', 2)
    RETURNING id INTO v_eng;
  END IF;

  -- ── Passage 1 ─────────────────────────────────────────────
  SELECT id INTO v_pass FROM edu.paper_passages WHERE paper_id = v_paper AND label = 'Passage 1';
  IF v_pass IS NULL THEN
    INSERT INTO edu.paper_passages (paper_id, section_id, label, body, sort_order)
    VALUES (v_paper, v_eng, 'Passage 1',
'Long time ago, babies began to talk immediately they were born. They could tell their mothers when they were sick, thirsty or hungry and needed some food.

One day, a woman left her newborn baby in the room and rushed to fetch water from a nearby stream. A woman, newly married, entered the room to fetch fire for her evening meal. Unknown to her that the baby was watching, she quickly took some of the meat that was kept across the hearth. When the mother of the baby returned, he disclosed to her that the woman had taken some of the meat.

The matter was taken to the king and the baby narrated how the woman hid the meat under her cloth before leaving the room. The new wife and her husband bowed their heads in shame. The king himself was embarrassed by the incident.

News of the incident spread all over the kingdom and people mocked the woman anytime they saw her passing. ''This cannot be allowed to continue'', cried the king. ''Babies must be stopped from embarrassing adults with their talks.''

He ordered that a lump of flesh be forced down the throats of newborn babies to prevent them from talking until they are old enough to differentiate between right and wrong.', 1)
    RETURNING id INTO v_pass;
  END IF;

  -- ── Mathematics 1-8 ───────────────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_maths, 1, 'mcq', 'Convert 574 to Roman numerals.',
     '[{"label":"A","text":"DLXXVI"},{"label":"B","text":"DLXXIV"},{"label":"C","text":"DLXXIII"},{"label":"D","text":"DLXIV"},{"label":"E","text":"DXXIV"}]'::jsonb,
     'B', '500 = D, 70 = LXX, 4 = IV. Putting them together gives DLXXIV.',
     'Mathematics', 'Number and numeration — Roman numerals', 'easy', true, 2),

    (v_paper, v_maths, 2, 'mcq', 'Correct 0.0579 to 2 significant figures.',
     '[{"label":"A","text":"0.05"},{"label":"B","text":"0.057"},{"label":"C","text":"0.0579"},{"label":"D","text":"0.058"},{"label":"E","text":"0.6"}]'::jsonb,
     'D', 'The first two significant figures are 5 and 7. The next digit is 9, so the 7 rounds up to 8, giving 0.058.',
     'Mathematics', 'Approximation — significant figures', 'easy', true, 2),

    (v_paper, v_maths, 3, 'mcq', 'Arrange 2/3, 5/6, 1/2 and 1/4 in ascending order.',
     '[{"label":"A","text":"1/4, 5/6, 2/3, 1/2"},{"label":"B","text":"1/4, 2/3, 1/2, 5/6"},{"label":"C","text":"1/2, 2/3, 1/4, 5/6"},{"label":"D","text":"1/4, 1/2, 2/3, 5/6"},{"label":"E","text":"2/3, 1/4, 1/2, 5/6"}]'::jsonb,
     'D', 'As decimals: 1/4 = 0.25, 1/2 = 0.5, 2/3 = 0.67, 5/6 = 0.83. Smallest to largest gives 1/4, 1/2, 2/3, 5/6.',
     'Mathematics', 'Fractions — ordering', 'easy', true, 2),

    (v_paper, v_maths, 4, 'mcq', 'Find the square root of 4/9.',
     '[{"label":"A","text":"3/2"},{"label":"B","text":"4/3"},{"label":"C","text":"2/3"},{"label":"D","text":"1/3"},{"label":"E","text":"1/4"}]'::jsonb,
     'C', 'Take the square root of the top and the bottom separately: √4 = 2 and √9 = 3, so the answer is 2/3.',
     'Mathematics', 'Squares and square roots', 'easy', true, 2),

    (v_paper, v_maths, 5, 'mcq', 'In a class, there are 20 girls and 30 boys. Find the ratio of girls to boys.',
     '[{"label":"A","text":"6 : 4"},{"label":"B","text":"4 : 5"},{"label":"C","text":"3 : 2"},{"label":"D","text":"2 : 3"},{"label":"E","text":"1 : 6"}]'::jsonb,
     'D', '20 : 30, and both divide by 10, giving 2 : 3. Order matters — girls first.',
     'Mathematics', 'Ratio and proportion', 'easy', true, 2),

    (v_paper, v_maths, 6, 'mcq', 'Ade bought a pair of shoes for ₦1000.00 and sold it for ₦800.00. What is his percentage loss?',
     '[{"label":"A","text":"25"},{"label":"B","text":"20"},{"label":"C","text":"15"},{"label":"D","text":"10"},{"label":"E","text":"5"}]'::jsonb,
     'B', 'Loss = ₦1000 − ₦800 = ₦200. Percentage loss = 200/1000 × 100 = 20%. The loss is always compared with the COST price.',
     'Mathematics', 'Percentage — profit and loss', 'medium', true, 2),

    (v_paper, v_maths, 7, 'mcq', 'Express 0.75 as a fraction.',
     '[{"label":"A","text":"1/4"},{"label":"B","text":"3/8"},{"label":"C","text":"1/2"},{"label":"D","text":"3/4"},{"label":"E","text":"5/4"}]'::jsonb,
     'D', '0.75 = 75/100, and dividing top and bottom by 25 gives 3/4.',
     'Mathematics', 'Decimals and fractions', 'easy', true, 2),

    (v_paper, v_maths, 8, 'mcq', 'Find the simple interest on ₦8000.00 for 4 years at 2% per annum.',
     '[{"label":"A","text":"₦640.00"},{"label":"B","text":"₦800.00"},{"label":"C","text":"₦940.00"},{"label":"D","text":"₦950.00"},{"label":"E","text":"₦1200.00"}]'::jsonb,
     'A', 'Simple interest = PRT/100 = (8000 × 2 × 4)/100 = ₦640.00.',
     'Mathematics', 'Simple interest', 'medium', true, 2)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── English comprehension 1-2 ─────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_eng, v_pass, 1, 'mcq', 'According to the passage, babies',
     '[{"label":"A","text":"cried for their needs."},{"label":"B","text":"talked before they were born."},{"label":"C","text":"talked but no longer do now."},{"label":"D","text":"talked only when they had problems."},{"label":"E","text":"talked only when they saw evil."}]'::jsonb,
     'C', 'The passage opens with babies talking from birth and ends with the king stopping it, so they once talked and no longer do.',
     'English Language', 'Comprehension — main idea', 'easy', true, 9),

    (v_paper, v_eng, v_pass, 2, 'mcq', 'The new wife entered the room to',
     '[{"label":"A","text":"check if the baby was awake."},{"label":"B","text":"cook her meal."},{"label":"C","text":"fetch fire for her meal."},{"label":"D","text":"steal the meat."},{"label":"E","text":"watch over the baby."}]'::jsonb,
     'C', 'The passage says she "entered the room to fetch fire for her evening meal". Taking the meat happened after she was already inside, so it was not why she entered.',
     'English Language', 'Comprehension — detail', 'medium', true, 9)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;
END $$;

-- Verify:
-- SELECT s.title, q.number, left(q.stem, 50), q.answer
-- FROM edu.past_questions q
-- JOIN edu.paper_sections s ON s.id = q.section_id
-- JOIN edu.past_papers p ON p.id = q.paper_id
-- WHERE p.exam_slug = 'ncee' AND p.year = 2017 ORDER BY s.sort_order, q.number;
