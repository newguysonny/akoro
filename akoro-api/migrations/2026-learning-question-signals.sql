-- =============================================================
-- 2026-learning-question-signals.sql — Phase 4a, Grand Plan §7.15.1.
-- The per-question signals struggle detection needs: question tags (skill,
-- format, time budget), the time taken to answer, and confusion pairs (the
-- wrong option chosen ↔ the concept the question tested). One row per
-- learner + session + question, written ONLY by recordQuestionSignals
-- (adaptive-learning/question-signals.js) from Agent Checks and the
-- proctored assessment. Read by learner-model.js readQuestionSignals.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.learning_question_signals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source             TEXT NOT NULL CHECK (source IN ('agent_check', 'proctored')),
  session_ref        TEXT NOT NULL CHECK (char_length(session_ref) BETWEEN 1 AND 180),
  question_ref       TEXT NOT NULL CHECK (char_length(question_ref) BETWEEN 1 AND 120),
  concept_id         UUID REFERENCES edu.concept_catalog(id) ON DELETE SET NULL,
  subject            TEXT,
  topic_label        TEXT,
  skill              TEXT CHECK (skill IS NULL OR skill IN ('recall', 'apply', 'transfer')),
  format             TEXT CHECK (format IS NULL OR format IN ('mcq', 'short', 'diagram', 'word_problem', 'calculation')),
  tag_source         TEXT NOT NULL DEFAULT 'derived' CHECK (tag_source IN ('question', 'derived')),
  time_budget_s      INT CHECK (time_budget_s IS NULL OR time_budget_s BETWEEN 1 AND 3600),
  time_to_answer_ms  INT CHECK (time_to_answer_ms IS NULL OR time_to_answer_ms >= 0),
  outcome            TEXT NOT NULL CHECK (outcome IN ('correct', 'wrong', 'guessed', 'unanswered')),
  score              NUMERIC CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  chosen_option      TEXT,
  correct_option     TEXT,
  confused_with      TEXT,
  confusion_concept  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (learner_id, session_ref, question_ref)
);
CREATE INDEX IF NOT EXISTS idx_question_signals_learner ON edu.learning_question_signals (learner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_signals_concept ON edu.learning_question_signals (learner_id, concept_id);
CREATE INDEX IF NOT EXISTS idx_question_signals_confusion ON edu.learning_question_signals (subject, confusion_concept, confused_with)
  WHERE confused_with IS NOT NULL;
GRANT ALL ON edu.learning_question_signals TO service_role;

-- Confusion pairs per subject, learned from judged errors (admin-reviewable;
-- anonymous totals only — a pair from fewer than 5 learners is not shown, D36).
CREATE OR REPLACE VIEW edu.learning_confusion_pairs AS
  SELECT subject, confusion_concept AS concept, confused_with,
         count(*)::INT AS times, count(DISTINCT learner_id)::INT AS learners, max(created_at) AS last_seen
    FROM edu.learning_question_signals
   WHERE confused_with IS NOT NULL AND outcome = 'wrong'
   GROUP BY subject, confusion_concept, confused_with
  HAVING count(DISTINCT learner_id) >= 5;
GRANT SELECT ON edu.learning_confusion_pairs TO service_role;

NOTIFY pgrst, 'reload schema';
