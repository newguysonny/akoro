-- =============================================================
-- 2026-seed-ncee-2019.sql
-- NCEE 2019 Paper I (Achievement Test) — all 110 questions transcribed from
-- the scan:
--   Part A  Mathematics    1-40 · Basic Science 41-50
--   Part B  English        1-40 (comprehension across two passages, lexis,
--                                structure) · Social Studies 41-60
--
-- As with 2017 the scan carries NO official marking scheme, so answers are
-- DERIVED, and the paper meta records that.
--
-- Seven questions are figures rather than text (a shaded border, angle
-- diagrams, a triangle, a foot skeleton). Their stems describe the figure in
-- words and are prefixed [Diagram]; the figure images themselves still need
-- extracting from the scan before those questions are complete.
--
-- Two questions are left UNVERIFIED with no answer, on purpose:
--   Maths 24  — the printed expression does not evaluate to any of its options,
--               so the scan is either damaged or the paper misprinted it.
--   Science 49 — the weather symbol is too degraded in the scan to identify.
-- Guessing either one would put a wrong answer in front of a child.
--
-- Idempotent: ON CONFLICT (paper_id, section_id, number) DO NOTHING.
-- =============================================================

DO $$
DECLARE
  v_paper  uuid;
  v_maths  uuid;
  v_sci    uuid;
  v_eng    uuid;
  v_lexis  uuid;
  v_struct uuid;
  v_social uuid;
  v_pass1  uuid;
  v_pass2  uuid;
BEGIN
  SELECT id INTO v_paper FROM edu.past_papers
   WHERE exam_slug = 'ncee' AND year = 2019 AND title = 'Paper I — Achievement Test';
  IF v_paper IS NULL THEN
    INSERT INTO edu.past_papers (exam_slug, year, title, paper_code, variant, duration_min, page_count, status, meta)
    VALUES ('ncee', 2019, 'Paper I — Achievement Test', 'Paper I', 'English and Mathematics', 130, 16, 'published',
      jsonb_build_object(
        'body', 'National Examinations Council (NECO), Minna',
        'parts', jsonb_build_array('Part A: Mathematics and Basic Science', 'Part B: English and Social Studies'),
        'question_counts', jsonb_build_object('mathematics_and_science', 50, 'english_and_social_studies', 60),
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

  SELECT id INTO v_sci FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'Basic Science';
  IF v_sci IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part A', 'Basic Science', 'Basic Science',
            'Answer all questions by choosing the most appropriate of the options lettered A – E (Nos. 41–50).', 2)
    RETURNING id INTO v_sci;
  END IF;

  SELECT id INTO v_eng FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'English — Comprehension';
  IF v_eng IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part B', 'English — Comprehension', 'English Language',
            'Read the passages below carefully and answer the questions that follow by choosing the most appropriate of the options lettered A – E (Nos. 1–10).', 3)
    RETURNING id INTO v_eng;
  END IF;

  SELECT id INTO v_lexis FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'English — Lexis';
  IF v_lexis IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part B', 'English — Lexis', 'English Language',
            'Choose the option nearest in meaning to the underlined word (Nos. 11–15), then the option most nearly opposite in meaning (Nos. 16–20).', 4)
    RETURNING id INTO v_lexis;
  END IF;

  SELECT id INTO v_struct FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'English — Structure';
  IF v_struct IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part B', 'English — Structure', 'English Language',
            'Complete each of the following statements with the most appropriate of the options lettered A – E (Nos. 21–40).', 5)
    RETURNING id INTO v_struct;
  END IF;

  SELECT id INTO v_social FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'Social Studies';
  IF v_social IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part B', 'Social Studies', 'Social Studies',
            'Answer all questions by choosing the most appropriate of the options lettered A – E (Nos. 41–60).', 6)
    RETURNING id INTO v_social;
  END IF;

  -- ── Passages ──────────────────────────────────────────────
  SELECT id INTO v_pass1 FROM edu.paper_passages WHERE paper_id = v_paper AND label = 'Passage 1';
  IF v_pass1 IS NULL THEN
    INSERT INTO edu.paper_passages (paper_id, section_id, label, body, sort_order)
    VALUES (v_paper, v_eng, 'Passage 1', 'Have you ever belched after a meal? How did you feel after belching? Although some people consider belching a bad habit, there are many health benefits that result from it.

Belching helps the food we eat to digest better and faster. Children normally feel uncomfortable and restless when they eat without belching. Belching relieves them of the discomfort.

Belching, after taking aerated drinks like beverages, helps us to pass out the gas content in them. Beverages contain acid, which is capable of making us heavy and develop a bloated belly. Belching also helps us to pass out carbon dioxide from our body. This helps in preventing bloated stomach and chest pain.

If we fail to belch after a meal, then we should expect a fart from the other end. But if these two things fail to happen, there is a problem somewhere; we should try and see a doctor.', 1)
    RETURNING id INTO v_pass1;
  END IF;

  SELECT id INTO v_pass2 FROM edu.paper_passages WHERE paper_id = v_paper AND label = 'Passage II';
  IF v_pass2 IS NULL THEN
    INSERT INTO edu.paper_passages (paper_id, section_id, label, body, sort_order)
    VALUES (v_paper, v_eng, 'Passage II', 'A rich man hired two men to clear a piece of farmland for him. He charged the labourers to do a thorough work for him and they assured him of a good job. When the men finished the job, the rich man went to inspect it. He discovered that one person did a very clean job while the other did a bad job.

The rich man decided not to ask the men to know who did the work well and who did not. Instead, he called both men and gave them two separate plots of land to clear for him. This time one labourer to a plot of land. He told them that he would pay them for everything on completion of the second job.

The bad labourer went to the site to clear it but he did not cut down the plants and shrubs to the roots. His second attempt at clearing the plot of land was worse than the first. The diligent labourer, on the other hand, took his time and cut the plants to the very roots, overturning all the dried leaves beneath the plants. At a spot, his cutlass hit something wrapped in a polythene bag. When he examined it, he realized that it was a parcel hidden by somebody in the bush. He picked it and after the day''s job, he reported his discovery to the land owner.

Without uttering a word, the rich man went to inspect the work done. When he came back, he called the two labourers and asked the one who found the parcel to open it. The parcel contained an amount that was double of what the rich man had promised to pay him for his work. The rich man congratulated him and asked him to take everything as his reward for the dedicated service rendered.', 2)
    RETURNING id INTO v_pass2;
  END IF;

  -- ── Mathematics 1-40 ──────────────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_maths, NULL, 1, 'mcq', 'How many seconds make up 3 1/2 minutes?',
     '[{"label": "A", "text": "240"}, {"label": "B", "text": "210"}, {"label": "C", "text": "180"}, {"label": "D", "text": "120"}, {"label": "E", "text": "60"}]'::jsonb,
     'B', 'One minute is 60 seconds, so 3.5 × 60 = 210 seconds.',
     'Mathematics', 'Measurement — time', 'easy', true, 2),

    (v_paper, v_maths, NULL, 2, 'mcq', 'Write in figure: Twelve thousand, seven hundred and two.',
     '[{"label": "A", "text": "12000702"}, {"label": "B", "text": "1200702"}, {"label": "C", "text": "127002"}, {"label": "D", "text": "120702"}, {"label": "E", "text": "12702"}]'::jsonb,
     'E', 'Twelve thousand is 12,000, seven hundred is 700 and two is 2, giving 12,702.',
     'Mathematics', 'Number and numeration — numeration', 'easy', true, 2),

    (v_paper, v_maths, NULL, 3, 'mcq', 'Write 30385 in words.',
     '[{"label": "A", "text": "Three thousand, three hundred and eighty five"}, {"label": "B", "text": "Three thousand, three hundred and fifty eight"}, {"label": "C", "text": "Thirty thousand, three hundred and eighty five"}, {"label": "D", "text": "Thirty thousand, eight hundred and five"}, {"label": "E", "text": "Thirty three thousand and eighty five"}]'::jsonb,
     'C', '30,385 breaks up as thirty thousand (30,000), three hundred (300) and eighty five (85).',
     'Mathematics', 'Number and numeration — numeration', 'easy', true, 2),

    (v_paper, v_maths, NULL, 4, 'mcq', 'Find the square root of 3 6/25.',
     '[{"label": "A", "text": "1 2/3"}, {"label": "B", "text": "1 4/5"}, {"label": "C", "text": "2 1/5"}, {"label": "D", "text": "2 4/5"}, {"label": "E", "text": "3 2/5"}]'::jsonb,
     'B', '3 6/25 = 81/25. √(81/25) = 9/5 = 1 4/5.',
     'Mathematics', 'Squares and square roots of fractions', 'medium', true, 2),

    (v_paper, v_maths, NULL, 5, 'mcq', 'Bola deposits ₦5,000.00 in a savings bank account. If she is paid an interest rate of 5% per annum for 2 years, how much is the simple interest?',
     '[{"label": "A", "text": "₦20.00"}, {"label": "B", "text": "₦50.00"}, {"label": "C", "text": "₦100.00"}, {"label": "D", "text": "₦200.00"}, {"label": "E", "text": "₦500.00"}]'::jsonb,
     'E', 'Simple interest = PRT/100 = (5000 × 5 × 2)/100 = ₦500.00.',
     'Mathematics', 'Simple interest', 'medium', true, 2),

    (v_paper, v_maths, NULL, 6, 'mcq', 'Change 4 1/2 days into hours.',
     '[{"label": "A", "text": "42"}, {"label": "B", "text": "72"}, {"label": "C", "text": "72 1/2"}, {"label": "D", "text": "88"}, {"label": "E", "text": "108"}]'::jsonb,
     'E', 'A day has 24 hours, so 4.5 × 24 = 108 hours.',
     'Mathematics', 'Measurement — time', 'easy', true, 2),

    (v_paper, v_maths, NULL, 7, 'mcq', 'Igho bought five books at ₦40.00 each and sold them for ₦150.00. What is the loss?',
     '[{"label": "A", "text": "₦50.00"}, {"label": "B", "text": "₦45.00"}, {"label": "C", "text": "₦40.00"}, {"label": "D", "text": "₦30.00"}, {"label": "E", "text": "₦5.00"}]'::jsonb,
     'A', 'Cost = 5 × 40 = ₦200. Loss = 200 − 150 = ₦50.00.',
     'Mathematics', 'Profit and loss', 'easy', true, 2),

    (v_paper, v_maths, NULL, 8, 'mcq', 'Ado bought a pair of shoes for ₦5,000.00 and sold it for ₦4,000.00. What is his percentage loss?',
     '[{"label": "A", "text": "10"}, {"label": "B", "text": "20"}, {"label": "C", "text": "30"}, {"label": "D", "text": "40"}, {"label": "E", "text": "50"}]'::jsonb,
     'B', 'Loss = 5000 − 4000 = ₦1000. Percentage loss = 1000/5000 × 100 = 20%.',
     'Mathematics', 'Percentage — profit and loss', 'medium', true, 3),

    (v_paper, v_maths, NULL, 9, 'mcq', 'In a class, there are 30 girls and 45 boys. Find the ratio of girls to boys.',
     '[{"label": "A", "text": "1 : 3"}, {"label": "B", "text": "2 : 3"}, {"label": "C", "text": "3 : 1"}, {"label": "D", "text": "3 : 2"}, {"label": "E", "text": "4 : 9"}]'::jsonb,
     'B', '30 : 45, and both divide by 15, giving 2 : 3.',
     'Mathematics', 'Ratio and proportion', 'easy', true, 3),

    (v_paper, v_maths, NULL, 10, 'mcq', 'One-fourth of a number is 5. Find the number.',
     '[{"label": "A", "text": "10"}, {"label": "B", "text": "15"}, {"label": "C", "text": "20"}, {"label": "D", "text": "25"}, {"label": "E", "text": "30"}]'::jsonb,
     'C', 'If x/4 = 5 then x = 5 × 4 = 20.',
     'Mathematics', 'Simple equations', 'easy', true, 3),

    (v_paper, v_maths, NULL, 11, 'mcq', 'A worker earns ₦4,000.00 per month. How much does he earn in 1/2 a year?',
     '[{"label": "A", "text": "₦48,000.00"}, {"label": "B", "text": "₦32,400.00"}, {"label": "C", "text": "₦24,000.00"}, {"label": "D", "text": "₦8,000.00"}, {"label": "E", "text": "₦2,000.00"}]'::jsonb,
     'C', 'Half a year is 6 months, so 4000 × 6 = ₦24,000.00.',
     'Mathematics', 'Money — multiplication', 'easy', true, 3),

    (v_paper, v_maths, NULL, 12, 'mcq', 'What must be subtracted from 3.10 to have 1.001?',
     '[{"label": "A", "text": "1.099"}, {"label": "B", "text": "1.999"}, {"label": "C", "text": "2.009"}, {"label": "D", "text": "2.099"}, {"label": "E", "text": "2.999"}]'::jsonb,
     'D', '3.100 − 1.001 = 2.099.',
     'Mathematics', 'Decimals — subtraction', 'medium', true, 3),

    (v_paper, v_maths, NULL, 13, 'mcq', 'What is the cost of 60 oranges if 4 cost ₦20.00?',
     '[{"label": "A", "text": "₦480.00"}, {"label": "B", "text": "₦400.00"}, {"label": "C", "text": "₦300.00"}, {"label": "D", "text": "₦150.00"}, {"label": "E", "text": "₦48.00"}]'::jsonb,
     'C', 'One orange costs 20 ÷ 4 = ₦5. Sixty cost 5 × 60 = ₦300.00.',
     'Mathematics', 'Ratio and proportion — unitary method', 'easy', true, 3),

    (v_paper, v_maths, NULL, 14, 'mcq', 'Arrange the following fractions in ascending order: 3/4, 5/8, 7/12, 2/3.',
     '[{"label": "A", "text": "2/3, 3/4, 5/8, 7/12"}, {"label": "B", "text": "3/4, 5/8, 7/12, 2/3"}, {"label": "C", "text": "7/12, 5/8, 2/3, 3/4"}, {"label": "D", "text": "5/8, 7/12, 3/4, 2/3"}, {"label": "E", "text": "2/3, 3/4, 7/12, 5/8"}]'::jsonb,
     'C', 'As decimals: 7/12 = 0.58, 5/8 = 0.625, 2/3 = 0.67, 3/4 = 0.75.',
     'Mathematics', 'Fractions — ordering', 'medium', true, 3),

    (v_paper, v_maths, NULL, 15, 'mcq', 'What is the place value of 5 in 504.13?',
     '[{"label": "A", "text": "5 hundreds"}, {"label": "B", "text": "5 hundredths"}, {"label": "C", "text": "5 tens"}, {"label": "D", "text": "5 thousands"}, {"label": "E", "text": "5 units"}]'::jsonb,
     'A', 'In 504.13 the 5 stands in the hundreds column.',
     'Mathematics', 'Place value', 'easy', true, 3),

    (v_paper, v_maths, NULL, 16, 'mcq', 'In a school, there are 478 boys and 329 girls. How many pupils are in the school altogether?',
     '[{"label": "A", "text": "908"}, {"label": "B", "text": "847"}, {"label": "C", "text": "817"}, {"label": "D", "text": "807"}, {"label": "E", "text": "708"}]'::jsonb,
     'D', '478 + 329 = 807.',
     'Mathematics', 'Whole numbers — addition', 'easy', true, 3),

    (v_paper, v_maths, NULL, 17, 'mcq', 'The difference of two numbers is 60. If the smaller number is 90, what is their sum?',
     '[{"label": "A", "text": "300"}, {"label": "B", "text": "240"}, {"label": "C", "text": "230"}, {"label": "D", "text": "150"}, {"label": "E", "text": "125"}]'::jsonb,
     'B', 'The larger number is 90 + 60 = 150, so the sum is 90 + 150 = 240.',
     'Mathematics', 'Word problems — whole numbers', 'medium', true, 4),

    (v_paper, v_maths, NULL, 18, 'mcq', 'Find the sum of these figures: 4.02, 13.9 and 7.1.',
     '[{"label": "A", "text": "17.03"}, {"label": "B", "text": "24.12"}, {"label": "C", "text": "25.02"}, {"label": "D", "text": "26.02"}, {"label": "E", "text": "27.04"}]'::jsonb,
     'C', '4.02 + 13.90 + 7.10 = 25.02.',
     'Mathematics', 'Decimals — addition', 'easy', true, 4),

    (v_paper, v_maths, NULL, 19, 'mcq', 'A motorist travelled at 72 km/h for 2 1/2 hours. How many kilometers has he covered?',
     '[{"label": "A", "text": "144"}, {"label": "B", "text": "176"}, {"label": "C", "text": "180"}, {"label": "D", "text": "210"}, {"label": "E", "text": "220"}]'::jsonb,
     'C', 'Distance = speed × time = 72 × 2.5 = 180 km.',
     'Mathematics', 'Speed, distance and time', 'medium', true, 4),

    (v_paper, v_maths, NULL, 20, 'mcq', 'Given that x + 3 = 12, find √x − 2.',
     '[{"label": "A", "text": "4"}, {"label": "B", "text": "3"}, {"label": "C", "text": "2"}, {"label": "D", "text": "1"}, {"label": "E", "text": "0"}]'::jsonb,
     'D', 'x = 12 − 3 = 9, so √9 − 2 = 3 − 2 = 1.',
     'Mathematics', 'Simple equations and square roots', 'medium', true, 4),

    (v_paper, v_maths, NULL, 21, 'mcq', 'Which of the following is not divisible by 5?',
     '[{"label": "A", "text": "45"}, {"label": "B", "text": "130"}, {"label": "C", "text": "265"}, {"label": "D", "text": "554"}, {"label": "E", "text": "690"}]'::jsonb,
     'D', 'A number divides by 5 only if it ends in 0 or 5. 554 ends in 4.',
     'Mathematics', 'Divisibility tests', 'easy', true, 4),

    (v_paper, v_maths, NULL, 22, 'mcq', 'One-third of a number is 9, what is the number?',
     '[{"label": "A", "text": "16"}, {"label": "B", "text": "20"}, {"label": "C", "text": "23"}, {"label": "D", "text": "25"}, {"label": "E", "text": "27"}]'::jsonb,
     'E', 'x/3 = 9, so x = 27.',
     'Mathematics', 'Simple equations', 'easy', true, 4),

    (v_paper, v_maths, NULL, 23, 'mcq', 'Ohanyere is 20 years old and her sister is x years younger. How old is Ohanyere''s sister?',
     '[{"label": "A", "text": "x^2 years"}, {"label": "B", "text": "20x years"}, {"label": "C", "text": "20/x years"}, {"label": "D", "text": "(x−20) years"}, {"label": "E", "text": "(20−x) years"}]'::jsonb,
     'E', 'Younger by x years means subtracting x from 20, giving (20 − x) years.',
     'Mathematics', 'Algebraic expressions from words', 'medium', true, 4),

    (v_paper, v_maths, NULL, 24, 'mcq', 'Simplify (1 1/2 − 1/2) + (2/3 + 1/2).',
     '[{"label": "A", "text": "3/2"}, {"label": "B", "text": "7/6"}, {"label": "C", "text": "1"}, {"label": "D", "text": "1/2"}, {"label": "E", "text": "1/3"}]'::jsonb,
     NULL, NULL,
     'Mathematics', 'Fractions — addition and subtraction', 'medium', false, 4),

    (v_paper, v_maths, NULL, 25, 'mcq', 'An aeroplane travelled to town X from town Y at 245 km/h for 2 hours. What is the distance covered?',
     '[{"label": "A", "text": "166 km"}, {"label": "B", "text": "360 km"}, {"label": "C", "text": "490 km"}, {"label": "D", "text": "500 km"}, {"label": "E", "text": "560 km"}]'::jsonb,
     'C', 'Distance = 245 × 2 = 490 km.',
     'Mathematics', 'Speed, distance and time', 'easy', true, 4),

    (v_paper, v_maths, NULL, 26, 'mcq', 'Find the value of the expression a^2 − b, if a = −2 and b = −1.',
     '[{"label": "A", "text": "−5"}, {"label": "B", "text": "−3"}, {"label": "C", "text": "1"}, {"label": "D", "text": "3"}, {"label": "E", "text": "5"}]'::jsonb,
     'E', 'a² = (−2)² = 4. Then 4 − (−1) = 4 + 1 = 5.',
     'Mathematics', 'Substitution with directed numbers', 'medium', true, 5),

    (v_paper, v_maths, NULL, 27, 'mcq', 'Find the volume of a cylinder with radius 4 cm and height 14 cm.',
     '[{"label": "A", "text": "704 cm^3"}, {"label": "B", "text": "532 cm^3"}, {"label": "C", "text": "337 cm^3"}, {"label": "D", "text": "226 cm^3"}, {"label": "E", "text": "109 cm^3"}]'::jsonb,
     'A', 'Volume = πr²h = 22/7 × 4 × 4 × 14 = 704 cm³.',
     'Mathematics', 'Mensuration — volume of a cylinder', 'hard', true, 5),

    (v_paper, v_maths, NULL, 28, 'mcq', 'Solve 17 + 2a = a + 7.',
     '[{"label": "A", "text": "−10"}, {"label": "B", "text": "−8"}, {"label": "C", "text": "8"}, {"label": "D", "text": "10"}, {"label": "E", "text": "21"}]'::jsonb,
     'A', '2a − a = 7 − 17, so a = −10.',
     'Mathematics', 'Simple equations', 'medium', true, 5),

    (v_paper, v_maths, NULL, 29, 'mcq', 'If 4/x = 2/3, what is the value of x/2?',
     '[{"label": "A", "text": "3"}, {"label": "B", "text": "6"}, {"label": "C", "text": "9"}, {"label": "D", "text": "12"}, {"label": "E", "text": "15"}]'::jsonb,
     'A', 'Cross-multiplying: 2x = 12, so x = 6 and x/2 = 3.',
     'Mathematics', 'Simple equations with fractions', 'medium', true, 5),

    (v_paper, v_maths, NULL, 30, 'mcq', '[Diagram] A rectangular border 8 m long and 5 m wide has an unshaded inner rectangle 4 m long and 3 m wide; the shaded portion is the border between them. Find the area of the shaded portion.',
     '[{"label": "A", "text": "52 m^2"}, {"label": "B", "text": "44 m^2"}, {"label": "C", "text": "32 m^2"}, {"label": "D", "text": "28 m^2"}, {"label": "E", "text": "12 m^2"}]'::jsonb,
     'D', 'Outer area = 8 × 5 = 40 m². Inner area = 4 × 3 = 12 m². Shaded = 40 − 12 = 28 m².',
     'Mathematics', 'Mensuration — area of a border', 'hard', true, 5),

    (v_paper, v_maths, NULL, 31, 'mcq', 'The sum of all angles in a triangle is equal to',
     '[{"label": "A", "text": "90°."}, {"label": "B", "text": "120°."}, {"label": "C", "text": "150°."}, {"label": "D", "text": "180°."}, {"label": "E", "text": "360°."}]'::jsonb,
     'D', 'The three angles of any triangle add up to 180°.',
     'Mathematics', 'Geometry — angles in a triangle', 'easy', true, 5),

    (v_paper, v_maths, NULL, 32, 'mcq', '[Diagram] In a right-angled triangle, one angle is 70° and another is the right angle. Find x, the third angle.',
     '[{"label": "A", "text": "20"}, {"label": "B", "text": "40"}, {"label": "C", "text": "90"}, {"label": "D", "text": "160"}, {"label": "E", "text": "180"}]'::jsonb,
     'A', 'Angles in a triangle add to 180°, so x = 180 − 90 − 70 = 20°.',
     'Mathematics', 'Geometry — angles in a triangle', 'medium', true, 5),

    (v_paper, v_maths, NULL, 33, 'mcq', 'If the area of a square is 36 cm^2, find the perimeter of the square.',
     '[{"label": "A", "text": "36 cm"}, {"label": "B", "text": "24 cm"}, {"label": "C", "text": "12 cm"}, {"label": "D", "text": "6 cm"}, {"label": "E", "text": "4 cm"}]'::jsonb,
     'B', 'Side = √36 = 6 cm, so perimeter = 4 × 6 = 24 cm.',
     'Mathematics', 'Mensuration — area and perimeter', 'medium', true, 6),

    (v_paper, v_maths, NULL, 34, 'mcq', '[Diagram] A right-angled triangle has hypotenuse 5 cm and base 3 cm. Find x, the remaining side.',
     '[{"label": "A", "text": "2 cm"}, {"label": "B", "text": "4 cm"}, {"label": "C", "text": "7 cm"}, {"label": "D", "text": "8 cm"}, {"label": "E", "text": "16 cm"}]'::jsonb,
     'B', 'By Pythagoras, x² = 5² − 3² = 25 − 9 = 16, so x = 4 cm.',
     'Mathematics', 'Geometry — Pythagoras'' theorem', 'medium', true, 6),

    (v_paper, v_maths, NULL, 35, 'mcq', 'The longest side of a right-angled triangle is known as',
     '[{"label": "A", "text": "adjacent."}, {"label": "B", "text": "diagonal."}, {"label": "C", "text": "hypotenuse."}, {"label": "D", "text": "opposite."}, {"label": "E", "text": "right angle."}]'::jsonb,
     'C', 'The side facing the right angle is the longest, and is called the hypotenuse.',
     'Mathematics', 'Geometry — right-angled triangles', 'easy', true, 6),

    (v_paper, v_maths, NULL, 36, 'mcq', '[Diagram] A straight line is cut by a ray, making two angles: x and 59°. Find the value of x.',
     '[{"label": "A", "text": "59°"}, {"label": "B", "text": "69°"}, {"label": "C", "text": "111°"}, {"label": "D", "text": "121°"}, {"label": "E", "text": "180°"}]'::jsonb,
     'D', 'Angles on a straight line add to 180°, so x = 180 − 59 = 121°.',
     'Mathematics', 'Geometry — angles on a straight line', 'easy', true, 6),

    (v_paper, v_maths, NULL, 37, 'mcq', 'Find the perimeter of a triangle with sides 5 cm, 7 cm and 9 cm.',
     '[{"label": "A", "text": "12 cm"}, {"label": "B", "text": "14 cm"}, {"label": "C", "text": "16 cm"}, {"label": "D", "text": "21 cm"}, {"label": "E", "text": "23 cm"}]'::jsonb,
     'D', 'Perimeter is the total of the sides: 5 + 7 + 9 = 21 cm.',
     'Mathematics', 'Mensuration — perimeter', 'easy', true, 6),

    (v_paper, v_maths, NULL, 38, 'mcq', '[Diagram] A square has each side marked 4 cm, and z is the length of a side. Find √z.',
     '[{"label": "A", "text": "2 cm"}, {"label": "B", "text": "8 cm"}, {"label": "C", "text": "12 cm"}, {"label": "D", "text": "16 cm"}, {"label": "E", "text": "20 cm"}]'::jsonb,
     'A', 'All sides of a square are equal, so z = 4 and √z = 2 cm.',
     'Mathematics', 'Squares and square roots', 'medium', true, 6),

    (v_paper, v_maths, NULL, 39, 'mcq', 'What is the mode of the scores: 1, 3, 2, 3, 5?',
     '[{"label": "A", "text": "0"}, {"label": "B", "text": "1"}, {"label": "C", "text": "2"}, {"label": "D", "text": "3"}, {"label": "E", "text": "5"}]'::jsonb,
     'D', 'The mode is the value appearing most often. 3 appears twice; every other score appears once.',
     'Mathematics', 'Statistics — mode', 'easy', true, 6),

    (v_paper, v_maths, NULL, 40, 'mcq', 'Find the average of the following set of numbers: 3, 2, 6, 1, 3.',
     '[{"label": "A", "text": "5"}, {"label": "B", "text": "4"}, {"label": "C", "text": "3"}, {"label": "D", "text": "2"}, {"label": "E", "text": "1"}]'::jsonb,
     'C', 'Total = 3 + 2 + 6 + 1 + 3 = 15, and 15 ÷ 5 = 3.',
     'Mathematics', 'Statistics — mean', 'easy', true, 6)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── Basic Science 41-50 ───────────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_sci, NULL, 41, 'mcq', 'The following are functions of the tongue except to',
     '[{"label": "A", "text": "detect the taste of food."}, {"label": "B", "text": "grind food in the mouth."}, {"label": "C", "text": "soften food in the mouth."}, {"label": "D", "text": "support movement of food in the mouth."}, {"label": "E", "text": "support swallowing of food."}]'::jsonb,
     'B', 'The tongue tastes, moves and helps swallow food. Grinding is done by the teeth.',
     'Basic Science', 'The human body — digestion', 'easy', true, 7),

    (v_paper, v_sci, NULL, 42, 'mcq', 'The part of a flower that receives pollen grains during pollination is called',
     '[{"label": "A", "text": "anther."}, {"label": "B", "text": "filament."}, {"label": "C", "text": "stigma."}, {"label": "D", "text": "sepal."}, {"label": "E", "text": "style."}]'::jsonb,
     'C', 'The stigma is the sticky tip of the female part that catches pollen. The anther produces it.',
     'Basic Science', 'Plants — reproduction', 'easy', true, 7),

    (v_paper, v_sci, NULL, 43, 'mcq', '[Diagram] The diagram below shows the bones of the foot. It is an example of _____ joint.',
     '[{"label": "A", "text": "gliding"}, {"label": "B", "text": "hinge"}, {"label": "C", "text": "pelvic"}, {"label": "D", "text": "pivot"}, {"label": "E", "text": "suture"}]'::jsonb,
     'A', 'The small tarsal bones of the foot slide over one another, which is a gliding joint.',
     'Basic Science', 'The human body — skeleton and joints', 'hard', true, 7),

    (v_paper, v_sci, NULL, 44, 'mcq', 'Which of the following blood components helps in clotting?',
     '[{"label": "A", "text": "Erythrocytes"}, {"label": "B", "text": "Plasma"}, {"label": "C", "text": "Platelets"}, {"label": "D", "text": "Red blood cells"}, {"label": "E", "text": "White blood cells"}]'::jsonb,
     'C', 'Platelets clump together at a wound to form a clot.',
     'Basic Science', 'The human body — blood', 'easy', true, 7),

    (v_paper, v_sci, NULL, 45, 'mcq', 'An example of an organic acid is',
     '[{"label": "A", "text": "acetic."}, {"label": "B", "text": "carbonic."}, {"label": "C", "text": "hydrochloric."}, {"label": "D", "text": "nitric."}, {"label": "E", "text": "sulphuric."}]'::jsonb,
     'A', 'Acetic acid, found in vinegar, comes from living things and contains carbon, so it is organic. The others are mineral acids.',
     'Basic Science', 'Chemistry — acids', 'medium', true, 7),

    (v_paper, v_sci, NULL, 46, 'mcq', 'The alkali used for soap production is _____ hydroxide.',
     '[{"label": "A", "text": "ammonium"}, {"label": "B", "text": "calcium"}, {"label": "C", "text": "lithium"}, {"label": "D", "text": "magnesium"}, {"label": "E", "text": "sodium"}]'::jsonb,
     'E', 'Soap is made by boiling fat or oil with sodium hydroxide (caustic soda).',
     'Basic Science', 'Chemistry — alkalis and soap', 'medium', true, 7),

    (v_paper, v_sci, NULL, 47, 'mcq', 'Limestone is used in the production of',
     '[{"label": "A", "text": "bronze."}, {"label": "B", "text": "cement."}, {"label": "C", "text": "fertilizer."}, {"label": "D", "text": "paint."}, {"label": "E", "text": "rubber."}]'::jsonb,
     'B', 'Limestone is the main raw material for cement.',
     'Basic Science', 'Natural resources', 'easy', true, 7),

    (v_paper, v_sci, NULL, 48, 'mcq', 'The path which each planet moves round the sun is called its',
     '[{"label": "A", "text": "axis."}, {"label": "B", "text": "distance."}, {"label": "C", "text": "line."}, {"label": "D", "text": "orbit."}, {"label": "E", "text": "rotation."}]'::jsonb,
     'D', 'A planet''s path round the sun is its orbit. The axis is the line it spins about.',
     'Basic Science', 'Earth and space', 'easy', true, 7),

    (v_paper, v_sci, NULL, 49, 'mcq', '[Diagram] The weather symbol represented in the diagram below is',
     '[{"label": "A", "text": "fog."}, {"label": "B", "text": "mist."}, {"label": "C", "text": "rain."}, {"label": "D", "text": "snow."}, {"label": "E", "text": "storm."}]'::jsonb,
     NULL, NULL,
     'Basic Science', 'Weather symbols', 'medium', false, 8),

    (v_paper, v_sci, NULL, 50, 'mcq', 'When Ada pulls an object, she is applying',
     '[{"label": "A", "text": "energy."}, {"label": "B", "text": "force."}, {"label": "C", "text": "power."}, {"label": "D", "text": "weight."}, {"label": "E", "text": "work."}]'::jsonb,
     'B', 'A push or a pull is a force.',
     'Basic Science', 'Physics — force', 'easy', true, 8)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── English comprehension 1-5 (Passage 1) ─────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_eng, v_pass1, 1, 'mcq', 'The most suitable title for this passage could be',
     '[{"label": "A", "text": "How to Belch."}, {"label": "B", "text": "The Bloated Stomach."}, {"label": "C", "text": "The Effect of Bloated Stomach."}, {"label": "D", "text": "The Importance of Belching."}, {"label": "E", "text": "The Process of Belching."}]'::jsonb,
     'D', 'The passage is built around the health benefits of belching, not around the bloated stomach or how belching happens.',
     'English Language', 'Comprehension — title and main idea', 'medium', true, 9),

    (v_paper, v_eng, v_pass1, 2, 'mcq', 'Belching helps our body system to release',
     '[{"label": "A", "text": "acid."}, {"label": "B", "text": "carbon dioxide."}, {"label": "C", "text": "food."}, {"label": "D", "text": "gas."}, {"label": "E", "text": "liquid."}]'::jsonb,
     'B', 'The passage states that belching helps us to pass out carbon dioxide from our body.',
     'English Language', 'Comprehension — detail', 'easy', true, 9),

    (v_paper, v_eng, v_pass1, 3, 'mcq', 'One of these is an effect of not belching in children.',
     '[{"label": "A", "text": "Bad habit"}, {"label": "B", "text": "Comfortability"}, {"label": "C", "text": "Farting"}, {"label": "D", "text": "Quick digestion"}, {"label": "E", "text": "Restlessness"}]'::jsonb,
     'E', 'The passage says children feel uncomfortable and restless when they eat without belching.',
     'English Language', 'Comprehension — detail', 'easy', true, 9),

    (v_paper, v_eng, v_pass1, 4, 'mcq', 'Which of the following words can replace ''benefits'' as used in the passage?',
     '[{"label": "A", "text": "Advantages"}, {"label": "B", "text": "Changes"}, {"label": "C", "text": "Damages"}, {"label": "D", "text": "Risks"}, {"label": "E", "text": "Services"}]'::jsonb,
     'A', 'Health benefits are health advantages — the good that comes of something.',
     'English Language', 'Vocabulary in context', 'easy', true, 9),

    (v_paper, v_eng, v_pass1, 5, 'mcq', 'To prevent a bloated stomach, one should always',
     '[{"label": "A", "text": "avoid aerated drinks."}, {"label": "B", "text": "avoid having chest pain."}, {"label": "C", "text": "eat food that can digest better and faster."}, {"label": "D", "text": "resist belching and farting often."}, {"label": "E", "text": "see a doctor."}]'::jsonb,
     'A', 'The passage blames the gas and acid in aerated drinks for the heavy, bloated belly.',
     'English Language', 'Comprehension — inference', 'medium', true, 10)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── English comprehension 6-10 (Passage II) ───────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_eng, v_pass2, 6, 'mcq', 'The rich man recruited the labourers to',
     '[{"label": "A", "text": "clear a piece of farmland."}, {"label": "B", "text": "cut plants."}, {"label": "C", "text": "grow plants and shrubs."}, {"label": "D", "text": "inspect a plot of land."}, {"label": "E", "text": "render dedicated service."}]'::jsonb,
     'A', 'The passage opens with the rich man hiring two men to clear a piece of farmland.',
     'English Language', 'Comprehension — detail', 'easy', true, 10),

    (v_paper, v_eng, v_pass2, 7, 'mcq', 'The labourers were instructed to',
     '[{"label": "A", "text": "assist each other."}, {"label": "B", "text": "complete the work."}, {"label": "C", "text": "do a very good work."}, {"label": "D", "text": "look for a parcel."}, {"label": "E", "text": "overturn all the dried leaves."}]'::jsonb,
     'C', 'He "charged the labourers to do a thorough work for him".',
     'English Language', 'Comprehension — detail', 'easy', true, 10),

    (v_paper, v_eng, v_pass2, 8, 'mcq', 'Which of these statements is true according to the passage?',
     '[{"label": "A", "text": "The diligent labourer was rewarded double fold."}, {"label": "B", "text": "The labourer who found the parcel did not report to the rich man."}, {"label": "C", "text": "The two labourers did a good job."}, {"label": "D", "text": "A parcel was not found."}, {"label": "E", "text": "The rich man hired three labourers."}]'::jsonb,
     'A', 'The parcel held double what he had been promised, and he was told to keep all of it.',
     'English Language', 'Comprehension — detail', 'medium', true, 11),

    (v_paper, v_eng, v_pass2, 9, 'mcq', 'We can conclude from the story that the parcel was hidden by',
     '[{"label": "A", "text": "a passer-by."}, {"label": "B", "text": "an unknown person."}, {"label": "C", "text": "some labourers."}, {"label": "D", "text": "the diligent worker."}, {"label": "E", "text": "the land owner."}]'::jsonb,
     'B', 'The passage says only that it was "a parcel hidden by somebody in the bush" — the person is never identified.',
     'English Language', 'Comprehension — inference', 'medium', true, 11),

    (v_paper, v_eng, v_pass2, 10, 'mcq', 'The rich man gave the labourers separate plots of land to work on in order to',
     '[{"label": "A", "text": "discourage team work."}, {"label": "B", "text": "double the amount of money he promised to give them."}, {"label": "C", "text": "find the hidden parcel."}, {"label": "D", "text": "identify the diligent labourer and reward him."}, {"label": "E", "text": "make the inspection of the work easier."}]'::jsonb,
     'D', 'He did not ask who had done the good job; he set a second, separate test to find out for himself.',
     'English Language', 'Comprehension — inference', 'medium', true, 11)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── English lexis 11-20 ───────────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_lexis, NULL, 11, 'mcq', 'Ade lives with his parents in the rural area.',
     '[{"label": "A", "text": "city"}, {"label": "B", "text": "metropolis"}, {"label": "C", "text": "region"}, {"label": "D", "text": "town"}, {"label": "E", "text": "village"}]'::jsonb,
     'E', 'A rural area is the countryside — a village rather than a city or town.',
     'English Language', 'Lexis — nearest in meaning', 'easy', true, 11),

    (v_paper, v_lexis, NULL, 12, 'mcq', 'The boy''s motive for killing the goat is wrong.',
     '[{"label": "A", "text": "desire"}, {"label": "B", "text": "excuse"}, {"label": "C", "text": "interest"}, {"label": "D", "text": "reason"}, {"label": "E", "text": "action"}]'::jsonb,
     'D', 'A motive is the reason behind an action.',
     'English Language', 'Lexis — nearest in meaning', 'medium', true, 11),

    (v_paper, v_lexis, NULL, 13, 'mcq', 'I am anxious to see my result.',
     '[{"label": "A", "text": "afraid"}, {"label": "B", "text": "eager"}, {"label": "C", "text": "glad"}, {"label": "D", "text": "hopeful"}, {"label": "E", "text": "willing"}]'::jsonb,
     'B', 'Anxious to do something means eager to do it.',
     'English Language', 'Lexis — nearest in meaning', 'medium', true, 11),

    (v_paper, v_lexis, NULL, 14, 'mcq', 'The government has decided to make History a mandatory subject at all levels of education.',
     '[{"label": "A", "text": "compulsory"}, {"label": "B", "text": "major"}, {"label": "C", "text": "minor"}, {"label": "D", "text": "preferred"}, {"label": "E", "text": "voluntary"}]'::jsonb,
     'A', 'Mandatory means required — compulsory. Voluntary is its opposite.',
     'English Language', 'Lexis — nearest in meaning', 'easy', true, 11),

    (v_paper, v_lexis, NULL, 15, 'mcq', 'Balkis was legally married to Sule.',
     '[{"label": "A", "text": "accidentally"}, {"label": "B", "text": "forcefully"}, {"label": "C", "text": "happily"}, {"label": "D", "text": "lawfully"}, {"label": "E", "text": "reluctantly"}]'::jsonb,
     'D', 'Legally means according to law, that is, lawfully.',
     'English Language', 'Lexis — nearest in meaning', 'easy', true, 12),

    (v_paper, v_lexis, NULL, 16, 'mcq', 'Tolu pleaded with her friend to accompany her to the party.',
     '[{"label": "A", "text": "commanded"}, {"label": "B", "text": "compelled"}, {"label": "C", "text": "convinced"}, {"label": "D", "text": "induced"}, {"label": "E", "text": "persuaded"}]'::jsonb,
     'A', 'To plead is to beg; the opposite is to command.',
     'English Language', 'Lexis — opposite in meaning', 'medium', true, 12),

    (v_paper, v_lexis, NULL, 17, 'mcq', 'The headboy was rewarded for his punctuality.',
     '[{"label": "A", "text": "dishonesty"}, {"label": "B", "text": "indolence"}, {"label": "C", "text": "lateness"}, {"label": "D", "text": "pride"}, {"label": "E", "text": "rudeness"}]'::jsonb,
     'C', 'Punctuality is being on time; its opposite is lateness.',
     'English Language', 'Lexis — opposite in meaning', 'easy', true, 12),

    (v_paper, v_lexis, NULL, 18, 'mcq', 'The investigating officer concealed his identity.',
     '[{"label": "A", "text": "changed"}, {"label": "B", "text": "disclosed"}, {"label": "C", "text": "falsified"}, {"label": "D", "text": "hid"}, {"label": "E", "text": "recognized"}]'::jsonb,
     'B', 'To conceal is to hide; the opposite is to disclose.',
     'English Language', 'Lexis — opposite in meaning', 'easy', true, 12),

    (v_paper, v_lexis, NULL, 19, 'mcq', 'The patient''s condition worsens by the day.',
     '[{"label": "A", "text": "declines"}, {"label": "B", "text": "decreases"}, {"label": "C", "text": "dwindles"}, {"label": "D", "text": "improves"}, {"label": "E", "text": "increases"}]'::jsonb,
     'D', 'If a condition worsens it gets worse; the opposite is that it improves.',
     'English Language', 'Lexis — opposite in meaning', 'easy', true, 12),

    (v_paper, v_lexis, NULL, 20, 'mcq', 'The street was deserted after the robbery incident.',
     '[{"label": "A", "text": "abandoned"}, {"label": "B", "text": "crowded"}, {"label": "C", "text": "empty"}, {"label": "D", "text": "occupied"}, {"label": "E", "text": "vacant"}]'::jsonb,
     'B', 'A deserted street is empty of people; the opposite is a crowded one.',
     'English Language', 'Lexis — opposite in meaning', 'medium', true, 12)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── English structure 21-40 ───────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_struct, NULL, 21, 'mcq', 'That is the man _____ killed the snake.',
     '[{"label": "A", "text": "which"}, {"label": "B", "text": "who"}, {"label": "C", "text": "who''s"}, {"label": "D", "text": "whom"}, {"label": "E", "text": "whose"}]'::jsonb,
     'B', 'The relative pronoun refers to a person doing the action, so who is used.',
     'English Language', 'Structure — relative pronouns', 'medium', true, 12),

    (v_paper, v_struct, NULL, 22, 'mcq', 'The dog ran _____ the road.',
     '[{"label": "A", "text": "across"}, {"label": "B", "text": "beside"}, {"label": "C", "text": "between"}, {"label": "D", "text": "over"}, {"label": "E", "text": "through"}]'::jsonb,
     'A', 'Moving from one side of a road to the other is running across it.',
     'English Language', 'Structure — prepositions', 'easy', true, 12),

    (v_paper, v_struct, NULL, 23, 'mcq', 'He _____ volleyball every Saturday.',
     '[{"label": "A", "text": "play"}, {"label": "B", "text": "played"}, {"label": "C", "text": "is playing"}, {"label": "D", "text": "plays"}, {"label": "E", "text": "has played"}]'::jsonb,
     'D', '"Every Saturday" is a habit, so the simple present is used, and He takes plays.',
     'English Language', 'Structure — subject-verb agreement', 'easy', true, 12),

    (v_paper, v_struct, NULL, 24, 'mcq', 'It _____ raining all day.',
     '[{"label": "A", "text": "had been"}, {"label": "B", "text": "had being"}, {"label": "C", "text": "has been"}, {"label": "D", "text": "have been"}, {"label": "E", "text": "have being"}]'::jsonb,
     'C', 'The rain started earlier and is still going, which is the present perfect continuous: has been raining.',
     'English Language', 'Structure — tenses', 'medium', true, 13),

    (v_paper, v_struct, NULL, 25, 'mcq', 'I received a present _____ Juliet.',
     '[{"label": "A", "text": "about"}, {"label": "B", "text": "by"}, {"label": "C", "text": "from"}, {"label": "D", "text": "of"}, {"label": "E", "text": "over"}]'::jsonb,
     'C', 'A present comes from the giver.',
     'English Language', 'Structure — prepositions', 'easy', true, 13),

    (v_paper, v_struct, NULL, 26, 'mcq', 'By the time she got home, her baby _____ slept for about three hours.',
     '[{"label": "A", "text": "had"}, {"label": "B", "text": "has"}, {"label": "C", "text": "have"}, {"label": "D", "text": "will have"}, {"label": "E", "text": "would have"}]'::jsonb,
     'A', 'The sleeping finished before the getting home, so the past perfect had slept is used.',
     'English Language', 'Structure — tenses', 'hard', true, 13),

    (v_paper, v_struct, NULL, 27, 'mcq', 'Sharon _____ to school twice a week.',
     '[{"label": "A", "text": "always walk"}, {"label": "B", "text": "is walking"}, {"label": "C", "text": "walk"}, {"label": "D", "text": "walked"}, {"label": "E", "text": "walks"}]'::jsonb,
     'E', 'A repeated action takes the simple present, and the singular Sharon takes walks.',
     'English Language', 'Structure — subject-verb agreement', 'easy', true, 13),

    (v_paper, v_struct, NULL, 28, 'mcq', 'My cousin _____ some apples from the supermarket yesterday.',
     '[{"label": "A", "text": "bought"}, {"label": "B", "text": "buy"}, {"label": "C", "text": "buys"}, {"label": "D", "text": "will buy"}, {"label": "E", "text": "would have bought"}]'::jsonb,
     'A', '"Yesterday" fixes the action in the past, so the simple past bought is used.',
     'English Language', 'Structure — tenses', 'easy', true, 13),

    (v_paper, v_struct, NULL, 29, 'mcq', 'The boy fell and injured',
     '[{"label": "A", "text": "himself."}, {"label": "B", "text": "hisself."}, {"label": "C", "text": "itself."}, {"label": "D", "text": "oneself."}, {"label": "E", "text": "yourself."}]'::jsonb,
     'A', 'The subject is a singular male, so the reflexive pronoun is himself. "Hisself" is not a word.',
     'English Language', 'Structure — reflexive pronouns', 'easy', true, 13),

    (v_paper, v_struct, NULL, 30, 'mcq', 'Active Voice: Her father loves her. Passive Voice: She _____ loved by her father.',
     '[{"label": "A", "text": "will be"}, {"label": "B", "text": "is"}, {"label": "C", "text": "was"}, {"label": "D", "text": "should be"}, {"label": "E", "text": "has been"}]'::jsonb,
     'B', 'The active verb loves is simple present, so the passive keeps the present: is loved.',
     'English Language', 'Structure — active and passive voice', 'medium', true, 13),

    (v_paper, v_struct, NULL, 31, 'mcq', 'Throw the _____ in the waste bin.',
     '[{"label": "A", "text": "gabage"}, {"label": "B", "text": "gabbage"}, {"label": "C", "text": "garbage"}, {"label": "D", "text": "garbige"}, {"label": "E", "text": "gerbage"}]'::jsonb,
     'C', 'The correct spelling is garbage.',
     'English Language', 'Structure — spelling', 'easy', true, 13),

    (v_paper, v_struct, NULL, 32, 'mcq', 'Yusuf''s brother is a',
     '[{"label": "A", "text": "hyphocrate."}, {"label": "B", "text": "hyphorcrete."}, {"label": "C", "text": "hypocrate."}, {"label": "D", "text": "hypocrite."}, {"label": "E", "text": "hyporcrate."}]'::jsonb,
     'D', 'The correct spelling is hypocrite.',
     'English Language', 'Structure — spelling', 'easy', true, 13),

    (v_paper, v_struct, NULL, 33, 'mcq', 'You can do it, _____ you?',
     '[{"label": "A", "text": "aren''t"}, {"label": "B", "text": "can"}, {"label": "C", "text": "can''t"}, {"label": "D", "text": "should"}, {"label": "E", "text": "won''t"}]'::jsonb,
     'C', 'A positive statement takes a negative tag with the same modal: can → can''t you?',
     'English Language', 'Structure — question tags', 'medium', true, 13),

    (v_paper, v_struct, NULL, 34, 'mcq', 'Olu worked hard _____ failed the examination.',
     '[{"label": "A", "text": "and"}, {"label": "B", "text": "but"}, {"label": "C", "text": "hence"}, {"label": "D", "text": "then"}, {"label": "E", "text": "though"}]'::jsonb,
     'B', 'Working hard and failing are in contrast, so but joins them.',
     'English Language', 'Structure — conjunctions', 'easy', true, 14),

    (v_paper, v_struct, NULL, 35, 'mcq', 'My mother flogged _____ because I went home late.',
     '[{"label": "A", "text": "he"}, {"label": "B", "text": "her"}, {"label": "C", "text": "him"}, {"label": "D", "text": "I"}, {"label": "E", "text": "me"}]'::jsonb,
     'E', 'The pronoun is the object of flogged and refers to the speaker, so the object form me is used.',
     'English Language', 'Structure — pronouns', 'medium', true, 14),

    (v_paper, v_struct, NULL, 36, 'mcq', 'He screamed and the child woke up',
     '[{"label": "A", "text": "angrily."}, {"label": "B", "text": "gracefully."}, {"label": "C", "text": "slowly."}, {"label": "D", "text": "suddenly."}, {"label": "E", "text": "timidly."}]'::jsonb,
     'D', 'A scream wakes someone all at once, which is suddenly.',
     'English Language', 'Structure — adverbs', 'easy', true, 14),

    (v_paper, v_struct, NULL, 37, 'mcq', 'Frank is the _____ man in his village.',
     '[{"label": "A", "text": "more poorer"}, {"label": "B", "text": "most poorest"}, {"label": "C", "text": "poor"}, {"label": "D", "text": "poorer"}, {"label": "E", "text": "poorest"}]'::jsonb,
     'E', 'Comparing him with everyone in the village takes the superlative poorest. "Most poorest" is a double superlative.',
     'English Language', 'Structure — comparison of adjectives', 'medium', true, 14),

    (v_paper, v_struct, NULL, 38, 'mcq', 'He has gone to church, _____ he?',
     '[{"label": "A", "text": "didn''t"}, {"label": "B", "text": "has"}, {"label": "C", "text": "hasn''t"}, {"label": "D", "text": "hadn''t"}, {"label": "E", "text": "haven''t"}]'::jsonb,
     'C', 'The statement uses has, so the negative tag is hasn''t he?',
     'English Language', 'Structure — question tags', 'medium', true, 14),

    (v_paper, v_struct, NULL, 39, 'mcq', 'The suffix _____ can be added to ''enjoy'' to form a new word.',
     '[{"label": "A", "text": "-able"}, {"label": "B", "text": "-al"}, {"label": "C", "text": "-ful"}, {"label": "D", "text": "-ly"}, {"label": "E", "text": "-sm"}]'::jsonb,
     'A', 'Enjoy + able gives enjoyable.',
     'English Language', 'Structure — suffixes', 'easy', true, 14),

    (v_paper, v_struct, NULL, 40, 'mcq', 'The prefix _____ can be added to the word ''complete'' to form a new word.',
     '[{"label": "A", "text": "en-"}, {"label": "B", "text": "il-"}, {"label": "C", "text": "im-"}, {"label": "D", "text": "in-"}, {"label": "E", "text": "un-"}]'::jsonb,
     'D', 'Complete takes in-, giving incomplete.',
     'English Language', 'Structure — prefixes', 'medium', true, 14)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── Social Studies 41-60 ──────────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_social, NULL, 41, 'mcq', 'Which of the following disasters could be man-made?',
     '[{"label": "A", "text": "Earthquake"}, {"label": "B", "text": "Erosion"}, {"label": "C", "text": "Hurricane"}, {"label": "D", "text": "Thunderstorm"}, {"label": "E", "text": "Volcanic eruption"}]'::jsonb,
     'B', 'Erosion is worsened by human activity such as deforestation, bad farming and poor drainage. The others are purely natural.',
     'Social Studies', 'Environmental problems', 'medium', true, 14),

    (v_paper, v_social, NULL, 42, 'mcq', 'Obedience to law and order will make a nation',
     '[{"label": "A", "text": "dangerous."}, {"label": "B", "text": "disorganized."}, {"label": "C", "text": "peaceful."}, {"label": "D", "text": "unstable."}, {"label": "E", "text": "weak."}]'::jsonb,
     'C', 'Where laws are obeyed there is order, and order brings peace.',
     'Social Studies', 'Citizenship — rule of law', 'easy', true, 14),

    (v_paper, v_social, NULL, 43, 'mcq', 'National unity can be threatened by',
     '[{"label": "A", "text": "establishment of unity schools."}, {"label": "B", "text": "inter-tribal marriages."}, {"label": "C", "text": "national festivals."}, {"label": "D", "text": "NYSC scheme."}, {"label": "E", "text": "religious intolerance."}]'::jsonb,
     'E', 'The first four bring Nigerians together; religious intolerance divides them.',
     'Social Studies', 'National unity', 'easy', true, 14),

    (v_paper, v_social, NULL, 44, 'mcq', 'Which of the following is not a social value?',
     '[{"label": "A", "text": "Contentment"}, {"label": "B", "text": "Faithfulness"}, {"label": "C", "text": "Fruitfulness"}, {"label": "D", "text": "Justice"}, {"label": "E", "text": "Loyalty"}]'::jsonb,
     'C', 'Contentment, faithfulness, justice and loyalty guide how people live together. Fruitfulness is about producing offspring or yield, not a social value.',
     'Social Studies', 'Social values', 'medium', true, 15),

    (v_paper, v_social, NULL, 45, 'mcq', 'The head of the local government council in Nigeria is referred to as the',
     '[{"label": "A", "text": "chairman."}, {"label": "B", "text": "clerk."}, {"label": "C", "text": "governor."}, {"label": "D", "text": "president."}, {"label": "E", "text": "speaker."}]'::jsonb,
     'A', 'A local government council is headed by a chairman.',
     'Social Studies', 'Government — tiers of government', 'easy', true, 15),

    (v_paper, v_social, NULL, 46, 'mcq', 'A document used to identify an electorate during election is',
     '[{"label": "A", "text": "driver''s license."}, {"label": "B", "text": "international passport."}, {"label": "C", "text": "national identity card."}, {"label": "D", "text": "permanent voter''s card."}, {"label": "E", "text": "school identity card."}]'::jsonb,
     'D', 'Only the permanent voter''s card (PVC) identifies a registered voter at a polling unit.',
     'Social Studies', 'Government — elections', 'easy', true, 15),

    (v_paper, v_social, NULL, 47, 'mcq', 'Which of the following sources of water is man-made?',
     '[{"label": "A", "text": "Ocean"}, {"label": "B", "text": "Rain"}, {"label": "C", "text": "River"}, {"label": "D", "text": "Spring"}, {"label": "E", "text": "Well"}]'::jsonb,
     'E', 'A well is dug by people; oceans, rain, rivers and springs occur naturally.',
     'Social Studies', 'Water resources', 'easy', true, 15),

    (v_paper, v_social, NULL, 48, 'mcq', 'Poverty in the society can be reduced through',
     '[{"label": "A", "text": "demonstration."}, {"label": "B", "text": "importation of goods."}, {"label": "C", "text": "migration to cities."}, {"label": "D", "text": "political thuggery."}, {"label": "E", "text": "youth empowerment."}]'::jsonb,
     'E', 'Empowering young people with skills and work gives them income, which reduces poverty.',
     'Social Studies', 'Economics — poverty', 'easy', true, 15),

    (v_paper, v_social, NULL, 49, 'mcq', 'The first tier of government in Nigeria is the _____ government.',
     '[{"label": "A", "text": "federal"}, {"label": "B", "text": "local"}, {"label": "C", "text": "regional"}, {"label": "D", "text": "state"}, {"label": "E", "text": "zonal"}]'::jsonb,
     'A', 'Nigeria has three tiers: federal (first), state (second) and local (third).',
     'Social Studies', 'Government — tiers of government', 'medium', true, 15),

    (v_paper, v_social, NULL, 50, 'mcq', 'The first agent of socialization is the',
     '[{"label": "A", "text": "church."}, {"label": "B", "text": "family."}, {"label": "C", "text": "market."}, {"label": "D", "text": "mosque."}, {"label": "E", "text": "school."}]'::jsonb,
     'B', 'A child learns first from the family, before school or place of worship.',
     'Social Studies', 'Socialization', 'easy', true, 15),

    (v_paper, v_social, NULL, 51, 'mcq', 'Community members perform the following functions except',
     '[{"label": "A", "text": "contributing towards economic development."}, {"label": "B", "text": "encouraging political thuggery."}, {"label": "C", "text": "maintaining peace and order."}, {"label": "D", "text": "protecting lives and properties."}, {"label": "E", "text": "socializing members."}]'::jsonb,
     'B', 'Thuggery destroys the community; the other four build it.',
     'Social Studies', 'Community', 'easy', true, 15),

    (v_paper, v_social, NULL, 52, 'mcq', 'Which of the following is regarded as negative behaviour?',
     '[{"label": "A", "text": "Discipline"}, {"label": "B", "text": "Hardwork"}, {"label": "C", "text": "Honesty"}, {"label": "D", "text": "Punctuality"}, {"label": "E", "text": "Truancy"}]'::jsonb,
     'E', 'Truancy — staying away from school without permission — is the only harmful habit listed.',
     'Social Studies', 'Social behaviour', 'easy', true, 15),

    (v_paper, v_social, NULL, 53, 'mcq', 'A group of people living in the same place having common characteristics defines a',
     '[{"label": "A", "text": "community."}, {"label": "B", "text": "market."}, {"label": "C", "text": "park."}, {"label": "D", "text": "port."}, {"label": "E", "text": "shrine."}]'::jsonb,
     'A', 'That is the definition of a community.',
     'Social Studies', 'Community', 'easy', true, 15),

    (v_paper, v_social, NULL, 54, 'mcq', 'The official voting age in Nigeria is',
     '[{"label": "A", "text": "14."}, {"label": "B", "text": "15."}, {"label": "C", "text": "16."}, {"label": "D", "text": "18."}, {"label": "E", "text": "21."}]'::jsonb,
     'D', 'Nigerians may register and vote from the age of 18.',
     'Social Studies', 'Government — elections', 'easy', true, 16),

    (v_paper, v_social, NULL, 55, 'mcq', 'The duties of a good citizen include the following except',
     '[{"label": "A", "text": "obedience to law."}, {"label": "B", "text": "payment of taxes."}, {"label": "C", "text": "promotion of cultism."}, {"label": "D", "text": "reporting crimes to law officers."}, {"label": "E", "text": "voting during election."}]'::jsonb,
     'C', 'Cultism is a crime. The other four are civic duties.',
     'Social Studies', 'Citizenship — rights and responsibilities', 'easy', true, 16),

    (v_paper, v_social, NULL, 56, 'mcq', 'A home that consists of a father, mother and their children is _____ family.',
     '[{"label": "A", "text": "compound"}, {"label": "B", "text": "extended"}, {"label": "C", "text": "nuclear"}, {"label": "D", "text": "polyandry"}, {"label": "E", "text": "polygamous"}]'::jsonb,
     'C', 'Parents and their children alone make a nuclear family.',
     'Social Studies', 'The family — types', 'easy', true, 16),

    (v_paper, v_social, NULL, 57, 'mcq', 'The legal separation between a husband and his wife is',
     '[{"label": "A", "text": "abscondment."}, {"label": "B", "text": "betrayal."}, {"label": "C", "text": "desertion."}, {"label": "D", "text": "disengagement."}, {"label": "E", "text": "divorce."}]'::jsonb,
     'E', 'Divorce is the legal ending of a marriage. Desertion is simply abandonment, with no court involved.',
     'Social Studies', 'The family — marriage', 'easy', true, 16),

    (v_paper, v_social, NULL, 58, 'mcq', 'Which of the following should be encouraged in our society?',
     '[{"label": "A", "text": "Corruption"}, {"label": "B", "text": "Honesty"}, {"label": "C", "text": "Kidnapping"}, {"label": "D", "text": "Poverty"}, {"label": "E", "text": "Thuggery"}]'::jsonb,
     'B', 'Honesty is the only one of the five that benefits society.',
     'Social Studies', 'Social values', 'easy', true, 16),

    (v_paper, v_social, NULL, 59, 'mcq', 'The use of medicine and other substances without doctor''s prescription is termed drug',
     '[{"label": "A", "text": "abuse."}, {"label": "B", "text": "addiction."}, {"label": "C", "text": "pushing."}, {"label": "D", "text": "selling."}, {"label": "E", "text": "trafficking."}]'::jsonb,
     'A', 'Using a drug wrongly or without prescription is drug abuse. Addiction is a possible result of it.',
     'Social Studies', 'Drug abuse', 'medium', true, 16),

    (v_paper, v_social, NULL, 60, 'mcq', 'Which of the following is a way of preventing drug abuse in schools?',
     '[{"label": "A", "text": "Enlightenment campaign"}, {"label": "B", "text": "Improper counseling"}, {"label": "C", "text": "Involvement in cult activities"}, {"label": "D", "text": "Keeping bad peer group"}, {"label": "E", "text": "Poor upbringing"}]'::jsonb,
     'A', 'Teaching pupils about the dangers of drugs prevents abuse; the other four encourage it.',
     'Social Studies', 'Drug abuse', 'easy', true, 16)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;
END $$;

-- Verify:
-- SELECT s.title, count(*), count(q.answer) AS answered
-- FROM edu.past_questions q
-- JOIN edu.paper_sections s ON s.id = q.section_id
-- JOIN edu.past_papers p ON p.id = q.paper_id
-- WHERE p.exam_slug = 'ncee' AND p.year = 2019 GROUP BY s.title ORDER BY s.title;
