-- =============================================================
-- 2026-seed-ncee-2017-aptitude.sql
-- NCEE 2017 Paper II (Aptitude Test) — 32 questions, and the figures that
-- make them answerable.
--
--   Part A  Quantitative Aptitude 1-17 — every question IS a diagram
--   Part B  Verbal Aptitude 1-15 — odd-one-out, word completion, sentence order
--
-- Each quantitative question carries BOTH the cropped figure (image_url, served
-- from the static /uploads path on the API) and a worded description in the stem. The
-- image is what a pupil answers from; the words are what makes the question
-- searchable, embeddable and usable by an agent — an image alone would embed as
-- an empty string and disappear from the bank.
--
-- The samples that define the rule for each set are stored as passages, since one
-- sample governs several questions exactly as a comprehension passage does.
--
-- EIGHT questions (quantitative 8-15) are left UNVERIFIED with no answer. Their
-- SAMPLE C and SAMPLE D figures do not yield a rule that fits all three worked
-- examples as scanned, so any answer would be a guess. The figures are attached
-- so a human can settle them.
--
-- Idempotent: ON CONFLICT (paper_id, section_id, number) DO NOTHING.
-- =============================================================

DO $$
DECLARE
  v_paper  uuid;
  v_quant  uuid;
  v_verbal uuid;
BEGIN
  SELECT id INTO v_paper FROM edu.past_papers
   WHERE exam_slug = 'ncee' AND year = 2017 AND title = 'Paper II — Aptitude Test';
  IF v_paper IS NULL THEN
    INSERT INTO edu.past_papers (exam_slug, year, title, paper_code, variant, duration_min, page_count, status, meta)
    VALUES ('ncee', 2017, 'Paper II — Aptitude Test', 'Paper II', 'Aptitude', 80, 7, 'published',
      jsonb_build_object(
        'body', 'National Examinations Council (NECO), Minna',
        'parts', jsonb_build_array('Part A: Quantitative and Vocational Aptitude', 'Part B: Verbal Aptitude'),
        'question_counts', jsonb_build_object('quantitative', 50, 'verbal', 40),
        'timing', '40 minutes per paper',
        'scan_note', 'the supplied scan contains quantitative 1-17 and verbal 1-15',
        'answer_source', 'derived — the scanned paper contains no official marking scheme'))
    RETURNING id INTO v_paper;
  END IF;

  SELECT id INTO v_quant FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'Quantitative Aptitude';
  IF v_quant IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part A', 'Quantitative Aptitude', 'Quantitative Aptitude',
            'The problems below are based on quantitative reasoning. Before answering the questions, study the sample that precedes each set and use it to solve the problems in that set.', 1)
    RETURNING id INTO v_quant;
  END IF;

  SELECT id INTO v_verbal FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'Verbal Aptitude';
  IF v_verbal IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part B', 'Verbal Aptitude', 'Verbal Aptitude',
            'Section I: pick the word that does not belong to the group. Section II: choose the letter that completes the first word and begins the second. Section III: choose the order in which the sentences should come.', 2)
    RETURNING id INTO v_verbal;
  END IF;

  -- ── The worked samples that define the rule for each set ──
  INSERT INTO edu.paper_passages (paper_id, section_id, label, body, image_url, sort_order)
  SELECT v_paper, v_quant, s.label, s.body, s.img, s.ord
  FROM (VALUES
    ('SAMPLE A', 'Three worked examples, each two circles above two circles: (4, 5) over (2, 10); (16, 6) over (4, 24); (4, 3) over (2, 6). In each one, top-left divided by bottom-left gives the number that top-right is multiplied by to reach bottom-right.', '/uploads/past-questions/ncee-2017-aptitude/sampleA.png', 1),
    ('SAMPLE B', 'Three worked examples, two numbers meeting at a circle below: 1 and 4 give 17; 1/2 and 1/2 give 3/8; 3 and 5 give 52. In each one the circle holds (left number) cubed plus (right number) squared.', '/uploads/past-questions/ncee-2017-aptitude/sampleB.png', 2),
    ('SAMPLE C', 'Three worked examples, each a box with a number on all four sides: top 1, left 2, right 5, bottom 3; top 1/4, left 1/3, right 1/2, bottom 3/2; top 4, left 7, right 3, bottom 1.', '/uploads/past-questions/ncee-2017-aptitude/sampleC.png', 3),
    ('SAMPLE D', 'Three worked examples, a circle with a number either side and a circle below: 2, (1), 3 giving 5; 3/2, (1/4), 1/2 giving 1/4; 7, (16), 3 giving 17.', '/uploads/past-questions/ncee-2017-aptitude/sampleD.png', 4),
    ('SAMPLE E', 'Three worked examples, two circles joined through a triangle to a circle below: 2 and 1 give 5; 3 and 2 give 11; 1/2 and 3/4 give 1. In each one the circle below holds (left) squared plus right.', '/uploads/past-questions/ncee-2017-aptitude/sampleE.png', 5)
  ) AS s(label, body, img, ord)
  WHERE NOT EXISTS (
    SELECT 1 FROM edu.paper_passages p WHERE p.paper_id = v_paper AND p.label = s.label
  );

  -- ── Quantitative Aptitude 1-17 ────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, number, type, stem, image_url, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_quant, 1, 'mcq', '[Diagram] Following SAMPLE A: two circles on top (1 and 5) joined to two circles below (1 and ?). Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q01.png',
     '[{"label": "A", "text": "1"}, {"label": "B", "text": "2"}, {"label": "C", "text": "3"}, {"label": "D", "text": "4"}, {"label": "E", "text": "5"}]'::jsonb,
     'E', 'In every sample, top-left ÷ bottom-left gives the number that top-right is multiplied by. Here 1 ÷ 1 = 1, so ? = 5 × 1 = 5.',
     'Quantitative Aptitude', 'Quantitative reasoning — number relationships', 'medium', true, 2),

    (v_paper, v_quant, 2, 'mcq', '[Diagram] Following SAMPLE A: top circles ? and 2, bottom circles 5 and 10. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q02.png',
     '[{"label": "A", "text": "10"}, {"label": "B", "text": "20"}, {"label": "C", "text": "25"}, {"label": "D", "text": "40"}, {"label": "E", "text": "50"}]'::jsonb,
     'C', 'Bottom-right ÷ top-right = 10 ÷ 2 = 5, and that is top-left ÷ bottom-left. So ? = 5 × 5 = 25.',
     'Quantitative Aptitude', 'Quantitative reasoning — number relationships', 'medium', true, 2),

    (v_paper, v_quant, 3, 'mcq', '[Diagram] Following SAMPLE A: top circles 49 and ?, bottom circles 7 and 35. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q03.png',
     '[{"label": "A", "text": "5"}, {"label": "B", "text": "6"}, {"label": "C", "text": "7"}, {"label": "D", "text": "8"}, {"label": "E", "text": "9"}]'::jsonb,
     'A', 'Top-left ÷ bottom-left = 49 ÷ 7 = 7. Bottom-right is top-right × 7, so ? = 35 ÷ 7 = 5.',
     'Quantitative Aptitude', 'Quantitative reasoning — number relationships', 'medium', true, 2),

    (v_paper, v_quant, 4, 'mcq', '[Diagram] Following SAMPLE A: top circles 36 and 5, bottom circles ? and 30. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q04.png',
     '[{"label": "A", "text": "3"}, {"label": "B", "text": "6"}, {"label": "C", "text": "9"}, {"label": "D", "text": "12"}, {"label": "E", "text": "15"}]'::jsonb,
     'B', 'Bottom-right ÷ top-right = 30 ÷ 5 = 6, which equals top-left ÷ bottom-left. So ? = 36 ÷ 6 = 6.',
     'Quantitative Aptitude', 'Quantitative reasoning — number relationships', 'medium', true, 2),

    (v_paper, v_quant, 5, 'mcq', '[Diagram] Following SAMPLE B: two numbers ? and 9 meet at a circle containing 82. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q05.png',
     '[{"label": "A", "text": "7"}, {"label": "B", "text": "5"}, {"label": "C", "text": "3"}, {"label": "D", "text": "2"}, {"label": "E", "text": "1"}]'::jsonb,
     'E', 'In every sample the bottom is (left number)³ + (right number)². Here ?³ + 9² = 82, so ?³ = 1 and ? = 1.',
     'Quantitative Aptitude', 'Quantitative reasoning — powers', 'hard', true, 2),

    (v_paper, v_quant, 6, 'mcq', '[Diagram] Following SAMPLE B: the numbers 2 and 7 meet at a circle containing ?. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q06.png',
     '[{"label": "A", "text": "57"}, {"label": "B", "text": "47"}, {"label": "C", "text": "37"}, {"label": "D", "text": "27"}, {"label": "E", "text": "14"}]'::jsonb,
     'A', 'The rule is left³ + right². Here 2³ + 7² = 8 + 49 = 57.',
     'Quantitative Aptitude', 'Quantitative reasoning — powers', 'hard', true, 3),

    (v_paper, v_quant, 7, 'mcq', '[Diagram] Following SAMPLE B: the numbers 4 and ? meet at a circle containing 89. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q07.png',
     '[{"label": "A", "text": "15"}, {"label": "B", "text": "10"}, {"label": "C", "text": "5"}, {"label": "D", "text": "3"}, {"label": "E", "text": "1"}]'::jsonb,
     'C', 'The rule is left³ + right². Here 4³ + ?² = 89, so ?² = 89 − 64 = 25 and ? = 5.',
     'Quantitative Aptitude', 'Quantitative reasoning — powers', 'hard', true, 3),

    (v_paper, v_quant, 8, 'mcq', '[Diagram] Following SAMPLE C: a box with 2 at the top, 3 on the left, 7 on the right and ? at the bottom. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q08.png',
     '[{"label": "A", "text": "9"}, {"label": "B", "text": "6"}, {"label": "C", "text": "5"}, {"label": "D", "text": "3"}, {"label": "E", "text": "1"}]'::jsonb,
     NULL, NULL,
     'Quantitative Aptitude', 'Quantitative reasoning — number relationships', 'hard', false, 3),

    (v_paper, v_quant, 9, 'mcq', '[Diagram] Following SAMPLE C: a box with 29 at the top, ? on the left, 23 on the right and 13 at the bottom. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q09.png',
     '[{"label": "A", "text": "10"}, {"label": "B", "text": "9"}, {"label": "C", "text": "6"}, {"label": "D", "text": "5"}, {"label": "E", "text": "4"}]'::jsonb,
     NULL, NULL,
     'Quantitative Aptitude', 'Quantitative reasoning — number relationships', 'hard', false, 3),

    (v_paper, v_quant, 10, 'mcq', '[Diagram] Following SAMPLE C: a box with 13 at the top, 2 on the left, ? on the right and 8 at the bottom. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q10.png',
     '[{"label": "A", "text": "15"}, {"label": "B", "text": "10"}, {"label": "C", "text": "9"}, {"label": "D", "text": "6"}, {"label": "E", "text": "3"}]'::jsonb,
     NULL, NULL,
     'Quantitative Aptitude', 'Quantitative reasoning — number relationships', 'hard', false, 3),

    (v_paper, v_quant, 11, 'mcq', '[Diagram] Following SAMPLE C: a box with ? at the top, 3 on the left, 1 on the right and 6 at the bottom. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q11.png',
     '[{"label": "A", "text": "18"}, {"label": "B", "text": "17"}, {"label": "C", "text": "15"}, {"label": "D", "text": "10"}, {"label": "E", "text": "9"}]'::jsonb,
     NULL, NULL,
     'Quantitative Aptitude', 'Quantitative reasoning — number relationships', 'hard', false, 3),

    (v_paper, v_quant, 12, 'mcq', '[Diagram] Following SAMPLE D: ? on the left, a circle containing 1/9, 8/9 on the right, and 1/9 in the circle below. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q12.png',
     '[{"label": "A", "text": "1/8"}, {"label": "B", "text": "1/2"}, {"label": "C", "text": "9/16"}, {"label": "D", "text": "3/4"}, {"label": "E", "text": "8/9"}]'::jsonb,
     NULL, NULL,
     'Quantitative Aptitude', 'Quantitative reasoning — fractions', 'hard', false, 3),

    (v_paper, v_quant, 13, 'mcq', '[Diagram] Following SAMPLE D: 3 on the left, a circle containing ?, 6 on the right, and 15 in the circle below. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q13.png',
     '[{"label": "A", "text": "12"}, {"label": "B", "text": "9"}, {"label": "C", "text": "7"}, {"label": "D", "text": "5"}, {"label": "E", "text": "3"}]'::jsonb,
     NULL, NULL,
     'Quantitative Aptitude', 'Quantitative reasoning — number relationships', 'hard', false, 4),

    (v_paper, v_quant, 14, 'mcq', '[Diagram] Following SAMPLE D: 1 on the left, a circle containing 4, ? on the right, and 7 in the circle below. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q14.png',
     '[{"label": "A", "text": "9"}, {"label": "B", "text": "7"}, {"label": "C", "text": "5"}, {"label": "D", "text": "3"}, {"label": "E", "text": "1"}]'::jsonb,
     NULL, NULL,
     'Quantitative Aptitude', 'Quantitative reasoning — number relationships', 'hard', false, 4),

    (v_paper, v_quant, 15, 'mcq', '[Diagram] Following SAMPLE D: 9 on the left, a circle containing 25, 4 on the right, and ? in the circle below. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q15.png',
     '[{"label": "A", "text": "36"}, {"label": "B", "text": "31"}, {"label": "C", "text": "28"}, {"label": "D", "text": "16"}, {"label": "E", "text": "15"}]'::jsonb,
     NULL, NULL,
     'Quantitative Aptitude', 'Quantitative reasoning — number relationships', 'hard', false, 4),

    (v_paper, v_quant, 16, 'mcq', '[Diagram] Following SAMPLE E: top circles ? and 5, joined through a triangle to a circle containing 9. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q16.png',
     '[{"label": "A", "text": "4"}, {"label": "B", "text": "3"}, {"label": "C", "text": "2"}, {"label": "D", "text": "1"}, {"label": "E", "text": "0"}]'::jsonb,
     'C', 'In every sample the bottom is (left)² + right. Here ?² + 5 = 9, so ?² = 4 and ? = 2.',
     'Quantitative Aptitude', 'Quantitative reasoning — squares', 'hard', true, 4),

    (v_paper, v_quant, 17, 'mcq', '[Diagram] Following SAMPLE E: top circles 3 and ?, joined through a triangle to a circle containing 13. Find the missing number.', '/uploads/past-questions/ncee-2017-aptitude/q17.png',
     '[{"label": "A", "text": "10"}, {"label": "B", "text": "6"}, {"label": "C", "text": "5"}, {"label": "D", "text": "4"}, {"label": "E", "text": "2"}]'::jsonb,
     'D', 'The rule is (left)² + right. Here 3² + ? = 13, so ? = 13 − 9 = 4.',
     'Quantitative Aptitude', 'Quantitative reasoning — squares', 'hard', true, 4)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── Verbal Aptitude 1-15 ──────────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, number, type, stem, image_url, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_verbal, 1, 'mcq', 'Pick out the one that does not belong to the group.', NULL,
     '[{"label": "A", "text": "Antenna"}, {"label": "B", "text": "Keyboard"}, {"label": "C", "text": "Monitor"}, {"label": "D", "text": "Mouse"}, {"label": "E", "text": "Speaker"}]'::jsonb,
     'A', 'A keyboard, monitor, mouse and speaker are all parts of a computer. An antenna belongs to a radio or television.',
     'Verbal Aptitude', 'Verbal reasoning — odd one out', 'easy', true, 11),

    (v_paper, v_verbal, 2, 'mcq', 'Pick out the one that does not belong to the group.', NULL,
     '[{"label": "A", "text": "Cheek"}, {"label": "B", "text": "Lip"}, {"label": "C", "text": "Palate"}, {"label": "D", "text": "Tongue"}, {"label": "E", "text": "Tooth"}]'::jsonb,
     'E', 'The cheek, lip, palate and tongue are all soft parts of the mouth. A tooth is hard.',
     'Verbal Aptitude', 'Verbal reasoning — odd one out', 'medium', true, 11),

    (v_paper, v_verbal, 3, 'mcq', 'Pick out the one that does not belong to the group.', NULL,
     '[{"label": "A", "text": "Annually"}, {"label": "B", "text": "Fortnightly"}, {"label": "C", "text": "Monthly"}, {"label": "D", "text": "Regularly"}, {"label": "E", "text": "Weekly"}]'::jsonb,
     'D', 'Annually, fortnightly, monthly and weekly each name a fixed interval. Regularly only says something repeats.',
     'Verbal Aptitude', 'Verbal reasoning — odd one out', 'medium', true, 11),

    (v_paper, v_verbal, 4, 'mcq', 'Pick out the one that does not belong to the group.', NULL,
     '[{"label": "A", "text": "Button"}, {"label": "B", "text": "Nail"}, {"label": "C", "text": "Needle"}, {"label": "D", "text": "Thimble"}, {"label": "E", "text": "Thread"}]'::jsonb,
     'B', 'A button, needle, thimble and thread are all used in sewing. A nail belongs to carpentry.',
     'Verbal Aptitude', 'Verbal reasoning — odd one out', 'easy', true, 11),

    (v_paper, v_verbal, 5, 'mcq', 'Pick out the one that does not belong to the group.', NULL,
     '[{"label": "A", "text": "Jupiter"}, {"label": "B", "text": "Mars"}, {"label": "C", "text": "Moon"}, {"label": "D", "text": "Saturn"}, {"label": "E", "text": "Uranus"}]'::jsonb,
     'C', 'Jupiter, Mars, Saturn and Uranus are planets. The Moon is a satellite.',
     'Verbal Aptitude', 'Verbal reasoning — odd one out', 'easy', true, 11),

    (v_paper, v_verbal, 6, 'mcq', 'Choose the letter that will correctly complete the first word and begin the second: Ra( )id / ( )lant', NULL,
     '[{"label": "A", "text": "b"}, {"label": "B", "text": "g"}, {"label": "C", "text": "p"}, {"label": "D", "text": "q"}, {"label": "E", "text": "s"}]'::jsonb,
     'C', 'The letter p gives Rapid and plant.',
     'Verbal Aptitude', 'Verbal reasoning — word completion', 'medium', true, 12),

    (v_paper, v_verbal, 7, 'mcq', 'Choose the letter that will correctly complete the first word and begin the second: Fough( ) / ( )rade', NULL,
     '[{"label": "A", "text": "c"}, {"label": "B", "text": "g"}, {"label": "C", "text": "l"}, {"label": "D", "text": "p"}, {"label": "E", "text": "t"}]'::jsonb,
     'E', 'The letter t gives Fought and trade.',
     'Verbal Aptitude', 'Verbal reasoning — word completion', 'medium', true, 12),

    (v_paper, v_verbal, 8, 'mcq', 'Choose the letter that will correctly complete the first word and begin the second: ( )ictate / ( )iamond', NULL,
     '[{"label": "A", "text": "D"}, {"label": "B", "text": "J"}, {"label": "C", "text": "S"}, {"label": "D", "text": "T"}, {"label": "E", "text": "V"}]'::jsonb,
     'A', 'The letter D gives Dictate and Diamond.',
     'Verbal Aptitude', 'Verbal reasoning — word completion', 'medium', true, 12),

    (v_paper, v_verbal, 9, 'mcq', 'Choose the letter that will correctly complete the first word and begin the second: Co( )lect / ( )ive', NULL,
     '[{"label": "A", "text": "a"}, {"label": "B", "text": "d"}, {"label": "C", "text": "f"}, {"label": "D", "text": "h"}, {"label": "E", "text": "l"}]'::jsonb,
     'E', 'The letter l gives Collect and live.',
     'Verbal Aptitude', 'Verbal reasoning — word completion', 'medium', true, 12),

    (v_paper, v_verbal, 10, 'mcq', 'Choose the letter that will correctly complete the first word and begin the second: ( )ssay / ( )njoy', NULL,
     '[{"label": "A", "text": "A"}, {"label": "B", "text": "E"}, {"label": "C", "text": "I"}, {"label": "D", "text": "O"}, {"label": "E", "text": "U"}]'::jsonb,
     'B', 'The letter E gives Essay and Enjoy.',
     'Verbal Aptitude', 'Verbal reasoning — word completion', 'medium', true, 12),

    (v_paper, v_verbal, 11, 'mcq', 'Choose which should come first, second and then third. 1. The building will be rebuilt. 2. The building got burnt. 3. The gas cylinder exploded.', NULL,
     '[{"label": "A", "text": "1, 2, 3"}, {"label": "B", "text": "1, 3, 2"}, {"label": "C", "text": "2, 1, 3"}, {"label": "D", "text": "3, 1, 2"}, {"label": "E", "text": "3, 2, 1"}]'::jsonb,
     'E', 'The explosion causes the fire, the fire destroys the building, and rebuilding comes last: 3, 2, 1.',
     'Verbal Aptitude', 'Verbal reasoning — sentence ordering', 'medium', true, 13),

    (v_paper, v_verbal, 12, 'mcq', 'Choose which should come first, second and then third. 1. The meeting will start at 8p.m. 2. I will be there. 3. The venue is Sheraton Hotel.', NULL,
     '[{"label": "A", "text": "1, 2, 3"}, {"label": "B", "text": "1, 3, 2"}, {"label": "C", "text": "2, 1, 3"}, {"label": "D", "text": "2, 3, 1"}, {"label": "E", "text": "3, 2, 1"}]'::jsonb,
     'B', 'Announce the time, then the place, then the promise to attend: 1, 3, 2.',
     'Verbal Aptitude', 'Verbal reasoning — sentence ordering', 'medium', true, 13),

    (v_paper, v_verbal, 13, 'mcq', 'Choose which should come first, second and then third. 1. The Computer game is very interesting. 2. I like computer games. 3. I bought a new Computer game.', NULL,
     '[{"label": "A", "text": "1, 2, 3"}, {"label": "B", "text": "1, 3, 2"}, {"label": "C", "text": "2, 1, 3"}, {"label": "D", "text": "2, 3, 1"}, {"label": "E", "text": "3, 2, 1"}]'::jsonb,
     'D', 'Liking them comes first, then buying one, then finding it interesting: 2, 3, 1.',
     'Verbal Aptitude', 'Verbal reasoning — sentence ordering', 'hard', true, 13),

    (v_paper, v_verbal, 14, 'mcq', 'Choose which should come first, second and then third. 1. I hope you have yours. 2. I bought it yesterday. 3. This is my textbook.', NULL,
     '[{"label": "A", "text": "1, 2, 3"}, {"label": "B", "text": "2, 1, 3"}, {"label": "C", "text": "2, 3, 1"}, {"label": "D", "text": "3, 1, 2"}, {"label": "E", "text": "3, 2, 1"}]'::jsonb,
     'E', 'Introduce the book, say when it was bought, then turn to the listener: 3, 2, 1.',
     'Verbal Aptitude', 'Verbal reasoning — sentence ordering', 'medium', true, 13),

    (v_paper, v_verbal, 15, 'mcq', 'Choose which should come first, second and then third. 1. AIDS is a disease. 2. It is deadly. 3. It can be avoided.', NULL,
     '[{"label": "A", "text": "1, 2, 3"}, {"label": "B", "text": "1, 3, 2"}, {"label": "C", "text": "2, 1, 3"}, {"label": "D", "text": "2, 3, 1"}, {"label": "E", "text": "3, 1, 2"}]'::jsonb,
     'A', 'Name it, describe it, then say what can be done: 1, 2, 3.',
     'Verbal Aptitude', 'Verbal reasoning — sentence ordering', 'easy', true, 13)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;
END $$;

-- ── Attach the figures to the 2019 diagram questions ────────────────────────
-- These were seeded with worded stems only; the crop is what a pupil actually
-- reads the angles and lengths off.
UPDATE edu.past_questions q
   SET image_url = v.img
  FROM (VALUES
    (30, '/uploads/past-questions/ncee-2019/q30.png'),
    (32, '/uploads/past-questions/ncee-2019/q32.png'),
    (34, '/uploads/past-questions/ncee-2019/q34.png'),
    (36, '/uploads/past-questions/ncee-2019/q36.png'),
    (38, '/uploads/past-questions/ncee-2019/q38.png')
  ) AS v(num, img)
  JOIN edu.paper_sections s ON s.title = 'Mathematics'
  JOIN edu.past_papers p ON p.id = s.paper_id AND p.exam_slug = 'ncee' AND p.year = 2019
 WHERE q.section_id = s.id AND q.number = v.num AND q.image_url IS DISTINCT FROM v.img;

UPDATE edu.past_questions q
   SET image_url = v.img
  FROM (VALUES
    (43, '/uploads/past-questions/ncee-2019/q43.png'),
    (49, '/uploads/past-questions/ncee-2019/q49.png')
  ) AS v(num, img)
  JOIN edu.paper_sections s ON s.title = 'Basic Science'
  JOIN edu.past_papers p ON p.id = s.paper_id AND p.exam_slug = 'ncee' AND p.year = 2019
 WHERE q.section_id = s.id AND q.number = v.num AND q.image_url IS DISTINCT FROM v.img;

-- Verify:
-- SELECT s.title, count(*) AS total, count(q.answer) AS answered, count(q.image_url) AS with_figure
-- FROM edu.past_questions q
-- JOIN edu.paper_sections s ON s.id = q.section_id
-- JOIN edu.past_papers p ON p.id = q.paper_id
-- WHERE p.exam_slug = 'ncee' GROUP BY s.title ORDER BY s.title;
