-- =============================================================
-- 2026-seed-ncee-2017-full.sql
-- The rest of NCEE 2017 Paper I, transcribed from the scan:
--   Mathematics            9-26   (1-8 seeded in 2026-seed-ncee-2017.sql)
--   English Comprehension  3-10   (1-2 already seeded) across two passages
--   English Lexis          11-20
--   English Structure      21-40
--   Social Studies         41-60
--
-- The scan carries NO official marking scheme, so every answer is DERIVED —
-- the maths is objectively checkable, the English and Social Studies answers
-- follow from the passage or from established fact. The paper's meta records
-- this so they are never mistaken for NECO's own key.
--
-- Idempotent: ON CONFLICT (paper_id, section_id, number) DO NOTHING.
-- Runs after 2026-seed-ncee-2017.sql, which creates the paper.
-- =============================================================

DO $$
DECLARE
  v_paper  uuid;
  v_maths  uuid;
  v_eng    uuid;
  v_lexis  uuid;
  v_struct uuid;
  v_social uuid;
  v_pass1  uuid;
  v_pass2  uuid;
BEGIN
  SELECT id INTO v_paper FROM edu.past_papers
   WHERE exam_slug = 'ncee' AND year = 2017 AND title = 'Paper I — Achievement Test';
  IF v_paper IS NULL THEN
    RAISE NOTICE 'NCEE 2017 paper not found — run 2026-seed-ncee-2017.sql first. Skipping.';
    RETURN;
  END IF;

  SELECT id INTO v_maths FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'Mathematics';
  SELECT id INTO v_eng   FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'English — Comprehension';
  SELECT id INTO v_pass1 FROM edu.paper_passages WHERE paper_id = v_paper AND label = 'Passage 1';

  -- Passage II (colour coding) — questions 6-10 hang off it.
  SELECT id INTO v_pass2 FROM edu.paper_passages WHERE paper_id = v_paper AND label = 'Passage II';
  IF v_pass2 IS NULL THEN
    INSERT INTO edu.paper_passages (paper_id, section_id, label, body, sort_order)
    VALUES (v_paper, v_eng, 'Passage II', 'If you could look inside a television set or inside the walls of a house, you''d find a network of electric wires. This network doesn''t puzzle electricians because each wire is a different colour to show what kind of wire it is. The different colours tell the electricians where each wire should be connected. We call this colour coding.

Colour coding helps many other people as well. People in business often use files with different coloured stickers on them. Each colour means something to the people using the files. Map makers also have colour codes. They use different colours for states or countries, so that you can see where one ends and another begins.

In the sport of archery, archers use bows to shoot arrows at targets. Each coloured circle on the target means a different number of points. An arrow in the golden bull''s-eye in the centre of the target scores the highest number. The archers shoot a certain number of arrows at the target and then collect their arrows. Each archer recognizes his arrows by the colours painted on the shafts.

Colours can also be codes for players or points in other games such as chess, draughts, snooker, tiddlywinks, marbles and cards.

(Culled from Child Craft World Book International Volume 15)', 2)
    RETURNING id INTO v_pass2;
  END IF;

  -- Remaining sections.
  SELECT id INTO v_lexis FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'English — Lexis';
  IF v_lexis IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part B', 'English — Lexis', 'English Language',
            'Choose from the options lettered A – E the one that is nearest in meaning (Nos. 11–15), then the one that is most nearly opposite in meaning (Nos. 16–20), to the word in italics.', 3)
    RETURNING id INTO v_lexis;
  END IF;

  SELECT id INTO v_struct FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'English — Structure';
  IF v_struct IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part B', 'English — Structure', 'English Language',
            'Complete each of the following statements with the most appropriate of the options lettered A – E (Nos. 21–40).', 4)
    RETURNING id INTO v_struct;
  END IF;

  SELECT id INTO v_social FROM edu.paper_sections WHERE paper_id = v_paper AND title = 'Social Studies';
  IF v_social IS NULL THEN
    INSERT INTO edu.paper_sections (paper_id, part, title, subject, instructions, sort_order)
    VALUES (v_paper, 'Part B', 'Social Studies', 'Social Studies',
            'Answer all questions by choosing the most appropriate of the options lettered A – E (Nos. 41–60).', 5)
    RETURNING id INTO v_social;
  END IF;

  -- ── Mathematics 9-26 ──────────────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_maths, NULL, 9, 'mcq', 'A girl bought 3 sachets of detergent for ₦120.00. For how much would she buy 20 sachets?',
     '[{"label": "A", "text": "₦800.00"}, {"label": "B", "text": "₦650.00"}, {"label": "C", "text": "₦500.00"}, {"label": "D", "text": "₦360.00"}, {"label": "E", "text": "₦240.00"}]'::jsonb,
     'A', 'One sachet costs 120 ÷ 3 = ₦40. Twenty sachets cost 40 × 20 = ₦800.00.',
     'Mathematics', 'Ratio and proportion — unitary method', 'easy', true, 3),

    (v_paper, v_maths, NULL, 10, 'mcq', 'The sum of 16 and 20 is divided by the product of 6 and 2, find the result.',
     '[{"label": "A", "text": "1"}, {"label": "B", "text": "3"}, {"label": "C", "text": "5"}, {"label": "D", "text": "7"}, {"label": "E", "text": "8"}]'::jsonb,
     'B', 'Sum = 16 + 20 = 36. Product = 6 × 2 = 12. Then 36 ÷ 12 = 3.',
     'Mathematics', 'Whole numbers — order of operations', 'easy', true, 3),

    (v_paper, v_maths, NULL, 11, 'mcq', '1/5 is equivalent to',
     '[{"label": "A", "text": "40%."}, {"label": "B", "text": "35%."}, {"label": "C", "text": "30%."}, {"label": "D", "text": "25%."}, {"label": "E", "text": "20%."}]'::jsonb,
     'E', '1/5 = 1 ÷ 5 = 0.2, and 0.2 × 100 = 20%.',
     'Mathematics', 'Fractions, decimals and percentages', 'easy', true, 3),

    (v_paper, v_maths, NULL, 12, 'mcq', 'If I spend 6/11 of my money on books, what fraction of it will remain?',
     '[{"label": "A", "text": "2/11"}, {"label": "B", "text": "3/11"}, {"label": "C", "text": "4/11"}, {"label": "D", "text": "5/11"}, {"label": "E", "text": "6/11"}]'::jsonb,
     'D', 'The whole is 11/11. Spending 6/11 leaves 11/11 − 6/11 = 5/11.',
     'Mathematics', 'Fractions — subtraction', 'easy', true, 3),

    (v_paper, v_maths, NULL, 13, 'mcq', 'Find 80% of ₦20.00.',
     '[{"label": "A", "text": "₦18.00"}, {"label": "B", "text": "₦16.00"}, {"label": "C", "text": "₦14.00"}, {"label": "D", "text": "₦12.00"}, {"label": "E", "text": "₦10.00"}]'::jsonb,
     'B', '80% of 20 = 80/100 × 20 = ₦16.00.',
     'Mathematics', 'Percentage of a quantity', 'easy', true, 3),

    (v_paper, v_maths, NULL, 14, 'mcq', 'Which of the following is not a perfect square?',
     '[{"label": "A", "text": "100"}, {"label": "B", "text": "81"}, {"label": "C", "text": "65"}, {"label": "D", "text": "49"}, {"label": "E", "text": "36"}]'::jsonb,
     'C', '100 = 10², 81 = 9², 49 = 7², 36 = 6². 65 has no whole-number square root, so it is not a perfect square.',
     'Mathematics', 'Squares and square roots', 'easy', true, 3),

    (v_paper, v_maths, NULL, 15, 'mcq', 'A gardener is paid ₦12,400.00 per month. Find his total annual salary.',
     '[{"label": "A", "text": "₦148,800.00"}, {"label": "B", "text": "₦144,800.00"}, {"label": "C", "text": "₦84,800.00"}, {"label": "D", "text": "₦62,000.00"}, {"label": "E", "text": "₦49,600.00"}]'::jsonb,
     'A', 'A year has 12 months, so 12,400 × 12 = ₦148,800.00.',
     'Mathematics', 'Money — multiplication', 'easy', true, 3),

    (v_paper, v_maths, NULL, 16, 'mcq', 'A can of coca-cola costs ₦120.00. How many cans can one buy with ₦960.00?',
     '[{"label": "A", "text": "1"}, {"label": "B", "text": "8"}, {"label": "C", "text": "9"}, {"label": "D", "text": "10"}, {"label": "E", "text": "12"}]'::jsonb,
     'B', '960 ÷ 120 = 8 cans.',
     'Mathematics', 'Money — division', 'easy', true, 3),

    (v_paper, v_maths, NULL, 17, 'mcq', 'Chinedu earns ₦2000.00 in 10 days. How much does he earn in 6 days if he earns equal amount daily?',
     '[{"label": "A", "text": "₦32,200.00"}, {"label": "B", "text": "₦32,000.00"}, {"label": "C", "text": "₦12,000.00"}, {"label": "D", "text": "₦3,200.00"}, {"label": "E", "text": "₦1,200.00"}]'::jsonb,
     'E', 'Daily earning = 2000 ÷ 10 = ₦200. In 6 days: 200 × 6 = ₦1,200.00.',
     'Mathematics', 'Ratio and proportion — unitary method', 'easy', true, 3),

    (v_paper, v_maths, NULL, 18, 'mcq', 'One-fifth of a number is subtracted from four-fifth of the same number. If the result is 9, what is the number?',
     '[{"label": "A", "text": "−15"}, {"label": "B", "text": "−9"}, {"label": "C", "text": "3"}, {"label": "D", "text": "9"}, {"label": "E", "text": "15"}]'::jsonb,
     'E', '4/5 of x minus 1/5 of x is 3/5 of x. So (3/5)x = 9, giving x = 9 × 5/3 = 15.',
     'Mathematics', 'Word problems — fractions of a number', 'medium', true, 4),

    (v_paper, v_maths, NULL, 19, 'mcq', 'A particular local government charges ₦1000.00 monthly for each market stall. What is the total rent collected monthly for 240 stalls?',
     '[{"label": "A", "text": "₦2400.00"}, {"label": "B", "text": "₦8600.00"}, {"label": "C", "text": "₦8900.00"}, {"label": "D", "text": "₦24000.00"}, {"label": "E", "text": "₦240,000.00"}]'::jsonb,
     'E', '1000 × 240 = ₦240,000.00.',
     'Mathematics', 'Money — multiplication', 'easy', true, 4),

    (v_paper, v_maths, NULL, 20, 'mcq', 'Ese is 23 years old and her younger sister is 19 years old. What was the sum of their ages 13 years ago?',
     '[{"label": "A", "text": "13 years"}, {"label": "B", "text": "14 years"}, {"label": "C", "text": "15 years"}, {"label": "D", "text": "16 years"}, {"label": "E", "text": "17 years"}]'::jsonb,
     'D', 'Thirteen years ago Ese was 23 − 13 = 10 and her sister was 19 − 13 = 6. Their sum is 10 + 6 = 16 years.',
     'Mathematics', 'Word problems — ages', 'medium', true, 4),

    (v_paper, v_maths, NULL, 21, 'mcq', 'Simplify 1/2 + 3/4 − 2/7 × (1/3 + 2).',
     '[{"label": "A", "text": "25/12"}, {"label": "B", "text": "17/12"}, {"label": "C", "text": "5/12"}, {"label": "D", "text": "3/4"}, {"label": "E", "text": "7/12"}]'::jsonb,
     'E', 'Brackets first: 1/3 + 2 = 7/3. Then 2/7 × 7/3 = 2/3. Now 1/2 + 3/4 = 5/4, and 5/4 − 2/3 = 15/12 − 8/12 = 7/12.',
     'Mathematics', 'Order of operations with fractions', 'hard', true, 4),

    (v_paper, v_maths, NULL, 22, 'mcq', 'Given that a = 7, b = 5 and c = 5. Find the square root of 3a + 2b + c.',
     '[{"label": "A", "text": "25"}, {"label": "B", "text": "15"}, {"label": "C", "text": "10"}, {"label": "D", "text": "9"}, {"label": "E", "text": "6"}]'::jsonb,
     'E', '3a + 2b + c = 21 + 10 + 5 = 36, and √36 = 6.',
     'Mathematics', 'Substitution in algebraic expressions', 'medium', true, 4),

    (v_paper, v_maths, NULL, 23, 'mcq', 'If 4y^2 − 37 = 27, what is the positive value of y?',
     '[{"label": "A", "text": "10"}, {"label": "B", "text": "4"}, {"label": "C", "text": "3"}, {"label": "D", "text": "2"}, {"label": "E", "text": "1"}]'::jsonb,
     'B', '4y² = 27 + 37 = 64, so y² = 16 and the positive y = 4.',
     'Mathematics', 'Simple equations', 'medium', true, 4),

    (v_paper, v_maths, NULL, 24, 'mcq', 'The area of a square is 9cm^2. Find the perimeter of the square.',
     '[{"label": "A", "text": "3cm"}, {"label": "B", "text": "6cm"}, {"label": "C", "text": "9cm"}, {"label": "D", "text": "12cm"}, {"label": "E", "text": "27cm"}]'::jsonb,
     'D', 'Side = √9 = 3 cm. A square has four equal sides, so perimeter = 4 × 3 = 12 cm.',
     'Mathematics', 'Mensuration — area and perimeter', 'medium', true, 4),

    (v_paper, v_maths, NULL, 25, 'mcq', 'What is the perimeter of a rectangle with length 8 1/2 cm and width 2 1/2 cm?',
     '[{"label": "A", "text": "16cm"}, {"label": "B", "text": "18cm"}, {"label": "C", "text": "20cm"}, {"label": "D", "text": "22cm"}, {"label": "E", "text": "24cm"}]'::jsonb,
     'D', 'Perimeter = 2(length + width) = 2(8.5 + 2.5) = 2 × 11 = 22 cm.',
     'Mathematics', 'Mensuration — perimeter', 'medium', true, 4),

    (v_paper, v_maths, NULL, 26, 'mcq', 'Given that 45 + 5t = 90, find the value of t.',
     '[{"label": "A", "text": "4"}, {"label": "B", "text": "5"}, {"label": "C", "text": "7"}, {"label": "D", "text": "9"}, {"label": "E", "text": "11"}]'::jsonb,
     'D', '5t = 90 − 45 = 45, so t = 9.',
     'Mathematics', 'Simple equations', 'easy', true, 4)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── English comprehension 3-5 (Passage 1) ─────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_eng, v_pass1, 3, 'mcq', 'The woman knew her meat was stolen because',
     '[{"label": "A", "text": "her neighbour informed her."}, {"label": "B", "text": "she hid somewhere in the room."}, {"label": "C", "text": "she saw the new wife coming out of her room."}, {"label": "D", "text": "the baby informed her."}, {"label": "E", "text": "the meat was not the way she left it."}]'::jsonb,
     'D', 'The passage says that when the mother returned, the baby "disclosed to her that the woman had taken some of the meat".',
     'English Language', 'Comprehension — detail', 'easy', true, 10),

    (v_paper, v_eng, v_pass1, 4, 'mcq', 'The most suitable title for this passage could be',
     '[{"label": "A", "text": "Babies and their Mothers."}, {"label": "B", "text": "The Embarrassed Woman."}, {"label": "C", "text": "The Final Judgment."}, {"label": "D", "text": "The Stolen Meat."}, {"label": "E", "text": "Why Babies Don''t Talk."}]'::jsonb,
     'E', 'The whole passage explains how babies lost the ability to talk, ending with the king''s order. The other titles cover only one incident in it.',
     'English Language', 'Comprehension — title and main idea', 'medium', true, 10),

    (v_paper, v_eng, v_pass1, 5, 'mcq', 'The king reasoned that if babies were allowed to continue talking, they could',
     '[{"label": "A", "text": "be too wise for their age."}, {"label": "B", "text": "disgrace adults with their talks."}, {"label": "C", "text": "disrespect adults."}, {"label": "D", "text": "disturb their mothers."}, {"label": "E", "text": "take over his kingdom."}]'::jsonb,
     'B', 'The king said "Babies must be stopped from embarrassing adults with their talks."',
     'English Language', 'Comprehension — detail', 'easy', true, 10)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── English comprehension 6-10 (Passage II) ───────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_eng, v_pass2, 6, 'mcq', 'Another word that can replace ''puzzle'' as used in the passage is',
     '[{"label": "A", "text": "confuse."}, {"label": "B", "text": "disorganize."}, {"label": "C", "text": "injure."}, {"label": "D", "text": "shock."}, {"label": "E", "text": "surprise."}]'::jsonb,
     'A', 'The wires do not "puzzle" electricians because the colours tell them what each wire is — that is, the wires do not confuse them.',
     'English Language', 'Vocabulary in context', 'medium', true, 11),

    (v_paper, v_eng, v_pass2, 7, 'mcq', 'The word ''golden'' as used in the passage is',
     '[{"label": "A", "text": "a noun."}, {"label": "B", "text": "a pronoun."}, {"label": "C", "text": "a verb."}, {"label": "D", "text": "an adjective."}, {"label": "E", "text": "an adverb."}]'::jsonb,
     'D', 'In "the golden bull''s-eye", golden describes the noun bull''s-eye, so it is an adjective.',
     'English Language', 'Parts of speech', 'easy', true, 11),

    (v_paper, v_eng, v_pass2, 8, 'mcq', 'According to the passage, in which of these games can colour be used to score points?',
     '[{"label": "A", "text": "Badminton"}, {"label": "B", "text": "Chess"}, {"label": "C", "text": "Football"}, {"label": "D", "text": "Hockey"}, {"label": "E", "text": "Scrabble"}]'::jsonb,
     'B', 'The last paragraph lists chess, draughts, snooker, tiddlywinks, marbles and cards.',
     'English Language', 'Comprehension — detail', 'easy', true, 11),

    (v_paper, v_eng, v_pass2, 9, 'mcq', 'To score high in the sport of archery, the arrow must',
     '[{"label": "A", "text": "be recognized by the archer."}, {"label": "B", "text": "hit the golden bull''s-eye."}, {"label": "C", "text": "hit the target."}, {"label": "D", "text": "reach the colours in the target."}, {"label": "E", "text": "remain in the target."}]'::jsonb,
     'B', 'The passage says an arrow in the golden bull''s-eye in the centre of the target scores the highest number.',
     'English Language', 'Comprehension — detail', 'easy', true, 11),

    (v_paper, v_eng, v_pass2, 10, 'mcq', 'Colour coding helps the following except',
     '[{"label": "A", "text": "archers."}, {"label": "B", "text": "businessmen."}, {"label": "C", "text": "electricians."}, {"label": "D", "text": "footballers."}, {"label": "E", "text": "map makers."}]'::jsonb,
     'D', 'Electricians, business people, map makers and archers are all named in the passage. Footballers are not.',
     'English Language', 'Comprehension — except questions', 'medium', true, 11)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── English lexis 11-20 ───────────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_lexis, NULL, 11, 'mcq', 'We found the missing items inside the cupboard in the store.',
     '[{"label": "A", "text": "abandoned"}, {"label": "B", "text": "forgotten"}, {"label": "C", "text": "hidden"}, {"label": "D", "text": "lost"}, {"label": "E", "text": "neglected"}]'::jsonb,
     'D', 'Something missing is something that has been lost.',
     'English Language', 'Lexis — nearest in meaning', 'easy', true, 11),

    (v_paper, v_lexis, NULL, 12, 'mcq', 'The pupils are eager to go on holiday.',
     '[{"label": "A", "text": "afraid"}, {"label": "B", "text": "desperate"}, {"label": "C", "text": "keen"}, {"label": "D", "text": "prepared"}, {"label": "E", "text": "reluctant"}]'::jsonb,
     'C', 'Eager means keen — full of enthusiasm for something.',
     'English Language', 'Lexis — nearest in meaning', 'easy', true, 11),

    (v_paper, v_lexis, NULL, 13, 'mcq', 'The enemies invaded the village.',
     '[{"label": "A", "text": "attacked"}, {"label": "B", "text": "conquered"}, {"label": "C", "text": "encamped"}, {"label": "D", "text": "searched"}, {"label": "E", "text": "visited"}]'::jsonb,
     'A', 'To invade is to enter by force, that is, to attack. Conquering is what may follow, not the same act.',
     'English Language', 'Lexis — nearest in meaning', 'medium', true, 11),

    (v_paper, v_lexis, NULL, 14, 'mcq', 'The eyewitness gave a vivid account of the fatal accident.',
     '[{"label": "A", "text": "brief"}, {"label": "B", "text": "brilliant"}, {"label": "C", "text": "detailed"}, {"label": "D", "text": "horrible"}, {"label": "E", "text": "vague"}]'::jsonb,
     'C', 'A vivid account is a clear, detailed one — the opposite of vague.',
     'English Language', 'Lexis — nearest in meaning', 'medium', true, 11),

    (v_paper, v_lexis, NULL, 15, 'mcq', 'I shall certainly pass my examinations if I study very hard.',
     '[{"label": "A", "text": "definitely"}, {"label": "B", "text": "doubtfully"}, {"label": "C", "text": "frankly"}, {"label": "D", "text": "honestly"}, {"label": "E", "text": "truthfully"}]'::jsonb,
     'A', 'Certainly and definitely both express being sure.',
     'English Language', 'Lexis — nearest in meaning', 'easy', true, 12),

    (v_paper, v_lexis, NULL, 16, 'mcq', 'The child felt secured in his mother''s arms.',
     '[{"label": "A", "text": "abandoned"}, {"label": "B", "text": "comfortable"}, {"label": "C", "text": "detached"}, {"label": "D", "text": "protected"}, {"label": "E", "text": "unsafe"}]'::jsonb,
     'E', 'The opposite of secure is unsafe. Protected is a synonym, not an opposite.',
     'English Language', 'Lexis — opposite in meaning', 'easy', true, 12),

    (v_paper, v_lexis, NULL, 17, 'mcq', 'The soldiers retreated when their commander was shot.',
     '[{"label": "A", "text": "advanced"}, {"label": "B", "text": "begged"}, {"label": "C", "text": "disappeared"}, {"label": "D", "text": "mourned"}, {"label": "E", "text": "surrendered"}]'::jsonb,
     'A', 'To retreat is to move back; the opposite is to advance.',
     'English Language', 'Lexis — opposite in meaning', 'easy', true, 12),

    (v_paper, v_lexis, NULL, 18, 'mcq', 'The criminal did not show any sign of guilt during interrogation.',
     '[{"label": "A", "text": "forgiveness"}, {"label": "B", "text": "innocence"}, {"label": "C", "text": "regret"}, {"label": "D", "text": "repentance"}, {"label": "E", "text": "weakness"}]'::jsonb,
     'B', 'Guilt and innocence are opposites.',
     'English Language', 'Lexis — opposite in meaning', 'easy', true, 12),

    (v_paper, v_lexis, NULL, 19, 'mcq', 'He was elevated for his hard work.',
     '[{"label": "A", "text": "demoted"}, {"label": "B", "text": "praised"}, {"label": "C", "text": "punished"}, {"label": "D", "text": "rebuked"}, {"label": "E", "text": "rewarded"}]'::jsonb,
     'A', 'To elevate is to raise in rank; the opposite is to demote.',
     'English Language', 'Lexis — opposite in meaning', 'easy', true, 12),

    (v_paper, v_lexis, NULL, 20, 'mcq', 'The comforting word sent him to sleep.',
     '[{"label": "A", "text": "angry"}, {"label": "B", "text": "consoling"}, {"label": "C", "text": "disturbing"}, {"label": "D", "text": "pleasing"}, {"label": "E", "text": "reassuring"}]'::jsonb,
     'C', 'Comforting words settle a person; disturbing words do the opposite.',
     'English Language', 'Lexis — opposite in meaning', 'medium', true, 12)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── English structure 21-40 ───────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_struct, NULL, 21, 'mcq', 'Of the three cars, my uncle''s is the _____ expensive.',
     '[{"label": "A", "text": "more"}, {"label": "B", "text": "most"}, {"label": "C", "text": "much"}, {"label": "D", "text": "quite"}, {"label": "E", "text": "so"}]'::jsonb,
     'B', 'Comparing three or more things takes the superlative, so it is most expensive. More is used for two.',
     'English Language', 'Structure — comparison of adjectives', 'medium', true, 12),

    (v_paper, v_struct, NULL, 22, 'mcq', 'I _____ some gifts from my friends.',
     '[{"label": "A", "text": "received"}, {"label": "B", "text": "receved"}, {"label": "C", "text": "recevied"}, {"label": "D", "text": "recieved"}, {"label": "E", "text": "riceived"}]'::jsonb,
     'A', 'The correct spelling is received — i before e except after c.',
     'English Language', 'Structure — spelling', 'easy', true, 12),

    (v_paper, v_struct, NULL, 23, 'mcq', 'The child is suffering from',
     '[{"label": "A", "text": "malnutretion."}, {"label": "B", "text": "malnutrision."}, {"label": "C", "text": "malnutrition."}, {"label": "D", "text": "manutrition."}, {"label": "E", "text": "melnutrition."}]'::jsonb,
     'C', 'The correct spelling is malnutrition.',
     'English Language', 'Structure — spelling', 'easy', true, 12),

    (v_paper, v_struct, NULL, 24, 'mcq', 'Okon has a _____ bag.',
     '[{"label": "A", "text": "beautiful leather small"}, {"label": "B", "text": "beautiful small leather"}, {"label": "C", "text": "leather beautiful small"}, {"label": "D", "text": "leather small beautiful"}, {"label": "E", "text": "small beautiful leather"}]'::jsonb,
     'B', 'English orders adjectives opinion, then size, then material: beautiful (opinion), small (size), leather (material).',
     'English Language', 'Structure — order of adjectives', 'hard', true, 12),

    (v_paper, v_struct, NULL, 25, 'mcq', 'Mother was cooking lunch when I _____ back home.',
     '[{"label": "A", "text": "came"}, {"label": "B", "text": "come"}, {"label": "C", "text": "comes"}, {"label": "D", "text": "had come"}, {"label": "E", "text": "have come"}]'::jsonb,
     'A', 'The past continuous "was cooking" is interrupted by a simple past action, so came is correct.',
     'English Language', 'Structure — tenses', 'medium', true, 13),

    (v_paper, v_struct, NULL, 26, 'mcq', 'I was advised to look _____ the word in the dictionary.',
     '[{"label": "A", "text": "at"}, {"label": "B", "text": "by"}, {"label": "C", "text": "down"}, {"label": "D", "text": "into"}, {"label": "E", "text": "up"}]'::jsonb,
     'E', 'The phrasal verb for finding a word in a dictionary is to look up.',
     'English Language', 'Structure — phrasal verbs', 'easy', true, 13),

    (v_paper, v_struct, NULL, 27, 'mcq', 'Miss Gloria, together with her cousin, _____ visiting the United States of America next year.',
     '[{"label": "A", "text": "are"}, {"label": "B", "text": "has been"}, {"label": "C", "text": "was"}, {"label": "D", "text": "were"}, {"label": "E", "text": "will be"}]'::jsonb,
     'E', '"Together with" does not change the singular subject, and "next year" makes it future — so will be visiting.',
     'English Language', 'Structure — concord and tense', 'hard', true, 13),

    (v_paper, v_struct, NULL, 28, 'mcq', 'Abraham is thirsty, _____ he?',
     '[{"label": "A", "text": "doesn''t"}, {"label": "B", "text": "is"}, {"label": "C", "text": "isn''t"}, {"label": "D", "text": "wasn''t"}, {"label": "E", "text": "will"}]'::jsonb,
     'C', 'A positive statement takes a negative question tag using the same verb: is → isn''t he?',
     'English Language', 'Structure — question tags', 'medium', true, 13),

    (v_paper, v_struct, NULL, 29, 'mcq', 'The most appropriate prefix for the word ''faithful'' is',
     '[{"label": "A", "text": "im-"}, {"label": "B", "text": "in-"}, {"label": "C", "text": "on-"}, {"label": "D", "text": "re-"}, {"label": "E", "text": "un-"}]'::jsonb,
     'E', 'The accepted opposite is unfaithful.',
     'English Language', 'Structure — prefixes', 'easy', true, 13),

    (v_paper, v_struct, NULL, 30, 'mcq', 'She _____ to school everyday.',
     '[{"label": "A", "text": "is trekking"}, {"label": "B", "text": "trek"}, {"label": "C", "text": "trekked"}, {"label": "D", "text": "trekking"}, {"label": "E", "text": "treks"}]'::jsonb,
     'E', '"Everyday" signals a habit, so the simple present is used, and the singular subject She takes treks.',
     'English Language', 'Structure — subject-verb agreement', 'medium', true, 13),

    (v_paper, v_struct, NULL, 31, 'mcq', 'The teacher asked _____ shoes were left outside?',
     '[{"label": "A", "text": "these"}, {"label": "B", "text": "this"}, {"label": "C", "text": "those"}, {"label": "D", "text": "what"}, {"label": "E", "text": "whose"}]'::jsonb,
     'E', 'The question is about ownership of the shoes, so whose is used.',
     'English Language', 'Structure — question words', 'medium', true, 13),

    (v_paper, v_struct, NULL, 32, 'mcq', 'The hunters warned the villagers to beware _____ dangerous animals.',
     '[{"label": "A", "text": "against"}, {"label": "B", "text": "by"}, {"label": "C", "text": "from"}, {"label": "D", "text": "of"}, {"label": "E", "text": "with"}]'::jsonb,
     'D', 'The fixed expression is beware of.',
     'English Language', 'Structure — prepositions', 'medium', true, 13),

    (v_paper, v_struct, NULL, 33, 'mcq', 'Father hurt _____ when he fell down.',
     '[{"label": "A", "text": "himself"}, {"label": "B", "text": "itself"}, {"label": "C", "text": "oneself"}, {"label": "D", "text": "theirself"}, {"label": "E", "text": "themselves"}]'::jsonb,
     'A', 'The subject Father is singular and masculine, so the reflexive pronoun is himself.',
     'English Language', 'Structure — reflexive pronouns', 'easy', true, 13),

    (v_paper, v_struct, NULL, 34, 'mcq', 'Tayo and Tom _____ in the same class.',
     '[{"label": "A", "text": "are"}, {"label": "B", "text": "has been"}, {"label": "C", "text": "is"}, {"label": "D", "text": "is being"}, {"label": "E", "text": "were being"}]'::jsonb,
     'A', 'Two people joined by "and" make a plural subject, which takes are.',
     'English Language', 'Structure — subject-verb agreement', 'easy', true, 13),

    (v_paper, v_struct, NULL, 35, 'mcq', 'She is beautiful _____ arrogant.',
     '[{"label": "A", "text": "also"}, {"label": "B", "text": "and"}, {"label": "C", "text": "but"}, {"label": "D", "text": "or"}, {"label": "E", "text": "while"}]'::jsonb,
     'C', 'The two qualities contrast, so the contrasting conjunction but is used.',
     'English Language', 'Structure — conjunctions', 'medium', true, 14),

    (v_paper, v_struct, NULL, 36, 'mcq', 'It is often said that if wishes were _____ would ride.',
     '[{"label": "A", "text": "available, beggars"}, {"label": "B", "text": "cars, the rich"}, {"label": "C", "text": "horses, beggars"}, {"label": "D", "text": "horses, the rich"}, {"label": "E", "text": "planes, beggars"}]'::jsonb,
     'C', 'The proverb is "If wishes were horses, beggars would ride."',
     'English Language', 'Structure — proverbs and idioms', 'medium', true, 14),

    (v_paper, v_struct, NULL, 37, 'mcq', 'The robbers _____ ran out of the room when they saw the police.',
     '[{"label": "A", "text": "angrily"}, {"label": "B", "text": "forcefully"}, {"label": "C", "text": "gradually"}, {"label": "D", "text": "quickly"}, {"label": "E", "text": "sluggishly"}]'::jsonb,
     'D', 'Robbers seeing the police would run away fast, so quickly is the sensible adverb.',
     'English Language', 'Structure — adverbs', 'easy', true, 14),

    (v_paper, v_struct, NULL, 38, 'mcq', 'The statement "You must finish your homework," the teacher said, rewritten in the reported speech form becomes, The teacher said that _____ homework.',
     '[{"label": "A", "text": "he could finish my"}, {"label": "B", "text": "he might finish his"}, {"label": "C", "text": "he must have finished his"}, {"label": "D", "text": "I might finish my"}, {"label": "E", "text": "I must finish my"}]'::jsonb,
     'E', 'The teacher addressed the speaker, so "you" becomes "I" and "your" becomes "my": the teacher said that I must finish my homework.',
     'English Language', 'Structure — reported speech', 'hard', true, 14),

    (v_paper, v_struct, NULL, 39, 'mcq', 'The statement "The cat ate the meat", rewritten in the passive form becomes, The meat _____ by the cat.',
     '[{"label": "A", "text": "had been eaten"}, {"label": "B", "text": "has been eaten"}, {"label": "C", "text": "is being eaten"}, {"label": "D", "text": "is eaten"}, {"label": "E", "text": "was eaten"}]'::jsonb,
     'E', 'The active verb is the simple past "ate", so the passive keeps the simple past: was eaten.',
     'English Language', 'Structure — active and passive voice', 'medium', true, 14),

    (v_paper, v_struct, NULL, 40, 'mcq', 'Indeed, _____ an examination without adequate preparation could lead to failure.',
     '[{"label": "A", "text": "to be writing"}, {"label": "B", "text": "to have been writing"}, {"label": "C", "text": "to have written"}, {"label": "D", "text": "to write"}, {"label": "E", "text": "writing"}]'::jsonb,
     'E', 'The blank is the subject of "could lead", so a gerund is needed: writing an examination … could lead to failure.',
     'English Language', 'Structure — gerunds', 'hard', true, 14)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;

  -- ── Social Studies 41-60 ──────────────────────────────────
  INSERT INTO edu.past_questions
    (paper_id, section_id, passage_id, number, type, stem, options, answer, explanation, subject, topic, difficulty, verified, source_page)
  VALUES
    (v_paper, v_social, NULL, 41, 'mcq', 'In Nigeria, _____ marriage is not lawful.',
     '[{"label": "A", "text": "Christian"}, {"label": "B", "text": "court"}, {"label": "C", "text": "Islamic"}, {"label": "D", "text": "same sex"}, {"label": "E", "text": "traditional"}]'::jsonb,
     'D', 'Nigerian law recognises Christian, court, Islamic and traditional marriages. Same sex marriage is prohibited.',
     'Social Studies', 'The family — marriage', 'easy', true, 14),

    (v_paper, v_social, NULL, 42, 'mcq', 'Which of the following is the responsibility of a good citizen?',
     '[{"label": "A", "text": "Delay in payment of taxes"}, {"label": "B", "text": "Disrespect for public property"}, {"label": "C", "text": "Disrespect for the dignity of others"}, {"label": "D", "text": "Fighting during election"}, {"label": "E", "text": "Service to the nation"}]'::jsonb,
     'E', 'The other four are things a good citizen avoids. Serving the nation is a civic responsibility.',
     'Social Studies', 'Citizenship — rights and responsibilities', 'easy', true, 14),

    (v_paper, v_social, NULL, 43, 'mcq', 'To make Nigeria great, citizens must be',
     '[{"label": "A", "text": "greedy."}, {"label": "B", "text": "irresponsible."}, {"label": "C", "text": "patriotic."}, {"label": "D", "text": "selfish."}, {"label": "E", "text": "tribalistic."}]'::jsonb,
     'C', 'Patriotism — loyalty and service to one''s country — is what builds a nation.',
     'Social Studies', 'Citizenship — national values', 'easy', true, 15),

    (v_paper, v_social, NULL, 44, 'mcq', 'Which of the following can lead to broken home?',
     '[{"label": "A", "text": "Honesty"}, {"label": "B", "text": "Obedience"}, {"label": "C", "text": "Patience"}, {"label": "D", "text": "Tolerance"}, {"label": "E", "text": "Unfaithfulness"}]'::jsonb,
     'E', 'Honesty, obedience, patience and tolerance hold a home together. Unfaithfulness breaks trust.',
     'Social Studies', 'The family — stability', 'easy', true, 15),

    (v_paper, v_social, NULL, 45, 'mcq', 'The totality of a people''s way of life is known as',
     '[{"label": "A", "text": "culture."}, {"label": "B", "text": "family."}, {"label": "C", "text": "festival."}, {"label": "D", "text": "marriage."}, {"label": "E", "text": "religion."}]'::jsonb,
     'A', 'Culture is the whole way of life of a people; festivals, marriage and religion are parts of it.',
     'Social Studies', 'Culture', 'easy', true, 15),

    (v_paper, v_social, NULL, 46, 'mcq', 'The appointment of Emirs or Chiefs in a state is the duty of the',
     '[{"label": "A", "text": "Chairman of the Local Government."}, {"label": "B", "text": "Commissioner for Local Government affairs."}, {"label": "C", "text": "Governor of the state."}, {"label": "D", "text": "President of the nation."}, {"label": "E", "text": "Speaker of the House."}]'::jsonb,
     'C', 'Traditional rulers are appointed and recognised by the state government, headed by the Governor.',
     'Social Studies', 'Government — traditional institutions', 'medium', true, 15),

    (v_paper, v_social, NULL, 47, 'mcq', 'The Nigeria flag has _____ colours.',
     '[{"label": "A", "text": "2"}, {"label": "B", "text": "3"}, {"label": "C", "text": "4"}, {"label": "D", "text": "5"}, {"label": "E", "text": "6"}]'::jsonb,
     'A', 'The flag is green-white-green — two colours, three bands.',
     'Social Studies', 'National symbols', 'easy', true, 15),

    (v_paper, v_social, NULL, 48, 'mcq', 'Which of these mineral resources is used for making roofing sheets?',
     '[{"label": "A", "text": "Chrome"}, {"label": "B", "text": "Columbite"}, {"label": "C", "text": "Copper"}, {"label": "D", "text": "Lead"}, {"label": "E", "text": "Zinc"}]'::jsonb,
     'E', 'Roofing sheets are commonly made of zinc-coated steel, which is why they are called zinc in everyday speech.',
     'Social Studies', 'Natural resources', 'medium', true, 15),

    (v_paper, v_social, NULL, 49, 'mcq', 'The instrument used for measuring temperature is called',
     '[{"label": "A", "text": "anemometer."}, {"label": "B", "text": "barometer."}, {"label": "C", "text": "hydrometer."}, {"label": "D", "text": "hygrometer."}, {"label": "E", "text": "thermometer."}]'::jsonb,
     'E', 'A thermometer measures temperature. An anemometer measures wind speed and a barometer measures air pressure.',
     'Social Studies', 'Weather instruments', 'easy', true, 15),

    (v_paper, v_social, NULL, 50, 'mcq', 'The number one citizen in Nigeria is the',
     '[{"label": "A", "text": "Chief Justice."}, {"label": "B", "text": "Governor."}, {"label": "C", "text": "Inspector General of Police."}, {"label": "D", "text": "President."}, {"label": "E", "text": "Senate President."}]'::jsonb,
     'D', 'The President is the Head of State and so the nation''s number one citizen.',
     'Social Studies', 'Government — the executive', 'easy', true, 15),

    (v_paper, v_social, NULL, 51, 'mcq', 'The adulteration of our culture is easily noticeable through which of the following?',
     '[{"label": "A", "text": "Dressing."}, {"label": "B", "text": "Fighting."}, {"label": "C", "text": "Plaiting."}, {"label": "D", "text": "Sleeping."}, {"label": "E", "text": "Walking."}]'::jsonb,
     'A', 'Foreign influence on culture shows first and most visibly in how people dress.',
     'Social Studies', 'Culture — cultural change', 'medium', true, 15),

    (v_paper, v_social, NULL, 52, 'mcq', 'An amount of money paid to a worker on a daily basis is called',
     '[{"label": "A", "text": "fees."}, {"label": "B", "text": "gifts."}, {"label": "C", "text": "loans."}, {"label": "D", "text": "subsides."}, {"label": "E", "text": "wages."}]'::jsonb,
     'E', 'Wages are paid by the day or the hour; a salary is paid monthly.',
     'Social Studies', 'Economics — income', 'easy', true, 15),

    (v_paper, v_social, NULL, 53, 'mcq', 'The following are self employment professions except',
     '[{"label": "A", "text": "banking."}, {"label": "B", "text": "bricklaying."}, {"label": "C", "text": "carpentry."}, {"label": "D", "text": "shoe making."}, {"label": "E", "text": "vulcanizing."}]'::jsonb,
     'A', 'Bricklaying, carpentry, shoe making and vulcanizing are typically done for oneself. Banking is paid employment in an organisation.',
     'Social Studies', 'Economics — occupations', 'medium', true, 16),

    (v_paper, v_social, NULL, 54, 'mcq', 'The largest seaport in Nigeria is located at',
     '[{"label": "A", "text": "Apapa."}, {"label": "B", "text": "Calabar."}, {"label": "C", "text": "Koko."}, {"label": "D", "text": "Port harcourt."}, {"label": "E", "text": "Warri."}]'::jsonb,
     'A', 'Apapa Port in Lagos is Nigeria''s largest and busiest seaport.',
     'Social Studies', 'Transportation', 'medium', true, 16),

    (v_paper, v_social, NULL, 55, 'mcq', 'Communication is a way of sending and receiving',
     '[{"label": "A", "text": "inputs."}, {"label": "B", "text": "messages."}, {"label": "C", "text": "network."}, {"label": "D", "text": "outputs."}, {"label": "E", "text": "telegram."}]'::jsonb,
     'B', 'Communication is the sending and receiving of messages; a telegram is only one means of doing it.',
     'Social Studies', 'Communication', 'easy', true, 16),

    (v_paper, v_social, NULL, 56, 'mcq', 'A man whose wife is dead is called a',
     '[{"label": "A", "text": "bachelor."}, {"label": "B", "text": "deceased."}, {"label": "C", "text": "husband."}, {"label": "D", "text": "widow."}, {"label": "E", "text": "widower."}]'::jsonb,
     'E', 'A widower is a man whose wife has died; a widow is a woman whose husband has died.',
     'Social Studies', 'The family', 'easy', true, 16),

    (v_paper, v_social, NULL, 57, 'mcq', 'The headquarters of the Nigeria Ports Authority is located in _____ State.',
     '[{"label": "A", "text": "Akwa-Ibom"}, {"label": "B", "text": "Cross-River"}, {"label": "C", "text": "Delta"}, {"label": "D", "text": "Lagos"}, {"label": "E", "text": "Rivers"}]'::jsonb,
     'D', 'The Nigerian Ports Authority is headquartered in Lagos, near Apapa Port.',
     'Social Studies', 'Transportation', 'medium', true, 16),

    (v_paper, v_social, NULL, 58, 'mcq', '''To defend her unity and uphold her honour and glory'' is a phrase taken from the',
     '[{"label": "A", "text": "Federal Constitution of Nigeria."}, {"label": "B", "text": "National Anthem."}, {"label": "C", "text": "National Identity Card."}, {"label": "D", "text": "National Pledge."}, {"label": "E", "text": "Nigeria Coat of Arms."}]'::jsonb,
     'D', 'The National Pledge reads "…to be faithful, loyal and honest, to serve Nigeria with all my strength, to defend her unity and uphold her honour and glory".',
     'Social Studies', 'National symbols', 'medium', true, 16),

    (v_paper, v_social, NULL, 59, 'mcq', 'Your brother''s or sister''s son is your',
     '[{"label": "A", "text": "cousin."}, {"label": "B", "text": "nephew."}, {"label": "C", "text": "niece."}, {"label": "D", "text": "step brother."}, {"label": "E", "text": "uncle."}]'::jsonb,
     'B', 'A nephew is the son of your brother or sister; the daughter is your niece.',
     'Social Studies', 'The family — relationships', 'easy', true, 16),

    (v_paper, v_social, NULL, 60, 'mcq', 'The movement of people and goods by sea is known as _____ transportation.',
     '[{"label": "A", "text": "air"}, {"label": "B", "text": "animal"}, {"label": "C", "text": "railway"}, {"label": "D", "text": "road"}, {"label": "E", "text": "water"}]'::jsonb,
     'E', 'Movement by sea, river or lake is water transportation.',
     'Social Studies', 'Transportation', 'easy', true, 16)
  ON CONFLICT (paper_id, section_id, number) DO NOTHING;
END $$;

-- Verify:
-- SELECT s.title, count(*) FROM edu.past_questions q
-- JOIN edu.paper_sections s ON s.id = q.section_id
-- JOIN edu.past_papers p ON p.id = q.paper_id
-- WHERE p.exam_slug = 'ncee' AND p.year = 2017 GROUP BY s.title ORDER BY s.title;
