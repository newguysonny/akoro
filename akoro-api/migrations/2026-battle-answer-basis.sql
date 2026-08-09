-- =============================================================
-- 2026-battle-answer-basis.sql
--
-- Where a battle answer came from.
--
-- Agents used to answer by rolling dice against a per-topic confidence number:
-- right with probability p, otherwise a random wrong option, never reading the
-- question. They now answer by RECALL — the question is embedded, the learner's
-- own edu.student_knowledge is searched, and the model is shown only those
-- notes. A correct answer means the learner's notes contained the answer.
--
-- Which makes a distinction that did not previously exist and has to be
-- recorded: an answer from memory and a lucky guess are not the same event.
-- Without this column they are the same row, and nothing downstream — the log,
-- the mark sheet, the revision it raises — could tell a learner whose notes
-- carried them from one who got away with it.
-- =============================================================

ALTER TABLE battle_answers ADD COLUMN IF NOT EXISTS answer_basis   TEXT;
ALTER TABLE battle_answers ADD COLUMN IF NOT EXISTS recalled_topic TEXT;

-- Rebuilt from the UNION of what exists and what is wanted, never narrowed:
-- every migration re-runs on every deploy, and a CHECK that rejects a value
-- already in the table would fail the deploy rather than the write.
DO $$
DECLARE wanted TEXT[] := ARRAY['recall', 'unknown', 'human'];
        found  TEXT[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT answer_basis), '{}') INTO found
  FROM battle_answers WHERE answer_basis IS NOT NULL;

  ALTER TABLE battle_answers DROP CONSTRAINT IF EXISTS battle_answers_basis_check;
  EXECUTE format(
    'ALTER TABLE battle_answers ADD CONSTRAINT battle_answers_basis_check CHECK (answer_basis IS NULL OR answer_basis = ANY (%L))',
    ARRAY(SELECT DISTINCT unnest(wanted || found)));
END $$;

COMMENT ON COLUMN battle_answers.answer_basis IS
  'recall = answered from the learner''s own notes; unknown = notes did not cover it, so this was a guess; human = a person tapped it.';
COMMENT ON COLUMN battle_answers.recalled_topic IS
  'Which of the learner''s notes the answer came from, when it came from one.';

-- Verify:
--   SELECT answer_basis, count(*), sum(is_correct::int) AS correct
--   FROM battle_answers GROUP BY 1;
