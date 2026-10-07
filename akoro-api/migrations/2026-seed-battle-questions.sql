-- =============================================================
-- 2026-seed-battle-questions.sql
-- Ensures every non-terminal battle actually has questions to play.
--
-- Several seeds (database-seed.sql, seed-community, the mock-matching demo
-- battles with fixed UUIDs) create battles + participants but NO
-- battle_questions — so the arena renders a scoreboard with no question.
-- This backfills a default 5-question set for any live/scheduled/lobby/
-- completed battle that has none, picking a maths or english set by subject.
--
-- Idempotent: guarded by NOT EXISTS, so re-runs and already-seeded battles
-- are left untouched. Real battles created via the challenge/accept flow get
-- their own questions and are skipped.
-- =============================================================

DO $$
DECLARE b RECORD;
BEGIN
  FOR b IN
    SELECT bt.id, lower(coalesce(bt.subject, '')) AS subj
    FROM public.battles bt
    WHERE bt.status IN ('live', 'scheduled', 'lobby', 'completed')
      AND NOT EXISTS (SELECT 1 FROM public.battle_questions q WHERE q.battle_id = bt.id)
  LOOP
    IF b.subj LIKE '%english%' OR b.subj LIKE '%vocab%' OR b.subj LIKE '%language%' THEN
      INSERT INTO public.battle_questions (battle_id, question_order, question_text, options_json, correct_answer_index, topic, subject, xp_value, time_limit_seconds) VALUES
        (b.id, 1, 'What does ''ephemeral'' mean?',       '["Permanent","Short-lived","Ancient","Enormous"]',                          1, 'Vocabulary', 'English', 30, 15),
        (b.id, 2, '''Ubiquitous'' means?',               '["Rare","Present everywhere","Ancient","Invisible"]',                       1, 'Vocabulary', 'English', 30, 15),
        (b.id, 3, 'Antonym of ''verbose''?',             '["Wordy","Lengthy","Concise","Repetitive"]',                                2, 'Antonyms',   'English', 35, 15),
        (b.id, 4, 'Which sentence is correct?',          '["She don''t like it","She doesn''t likes it","She doesn''t like it","She not like it"]', 2, 'Grammar', 'English', 30, 15),
        (b.id, 5, '''Benevolent'' most nearly means?',   '["Cruel","Well-meaning","Cowardly","Boastful"]',                            1, 'Vocabulary', 'English', 35, 15);
    ELSE
      INSERT INTO public.battle_questions (battle_id, question_order, question_text, options_json, correct_answer_index, topic, subject, xp_value, time_limit_seconds) VALUES
        (b.id, 1, 'Derivative of ln(x)?',            '["x","1/x","e^x","ln(x)/x"]',                          1, 'Differentiation', 'Mathematics', 30, 15),
        (b.id, 2, 'Solve for x: 5x - 3 = 22',        '["x = 4","x = 5","x = 3","x = 6"]',                     1, 'Algebra',         'Mathematics', 30, 15),
        (b.id, 3, 'What is d/dx of sin(3x)?',        '["cos(3x)","3cos(3x)","-3cos(3x)","3sin(3x)"]',        1, 'Chain Rule',      'Mathematics', 35, 15),
        (b.id, 4, 'Integrate: 3x^2 dx',              '["6x + C","x^3 + C","x^3","3x^3 + C"]',                 1, 'Integration',     'Mathematics', 30, 15),
        (b.id, 5, 'What is d/dx of e^(2x)?',         '["e^(2x)","2e^x","2e^(2x)","e^x"]',                     2, 'Differentiation', 'Mathematics', 40, 15);
    END IF;
    UPDATE public.battles SET total_questions = 5 WHERE id = b.id;
  END LOOP;
END $$;

-- Verify:
-- SELECT b.title, b.status, count(q.*) AS questions
--   FROM public.battles b LEFT JOIN public.battle_questions q ON q.battle_id = b.id
--   GROUP BY b.id, b.title, b.status ORDER BY questions;
