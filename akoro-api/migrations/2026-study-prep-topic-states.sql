-- =============================================================
-- 2026-study-prep-topic-states.sql — Grand Plan Phase 5, §8.3, D15
--
--   1. The topic state machine (§8.3): study_prep_topics.status takes the
--      full set — queued, active, diagnostic_ready, diagnostic,
--      intervention_required, awaiting_teaching, retest_ready, retest,
--      understood, flagged_gap, capped_out, deferred. The moves themselves
--      are checked in code (TOPIC_TRANSITIONS, the Study Prep workflow
--      definition); the CHECK keeps any other word out.
--   2. teaching_workflow_id: the Teaching Workflow a topic waits on while
--      awaiting_teaching (D15 — every intervention is a teaching session).
--   3. edu.study_prep_submit_attempt: the single-transaction submit. The
--      attempt's score, the run record (the exam-prep run is an attempt
--      record now) and the topic's outcome are written together or not at
--      all, and only once: a second submit of the same attempt changes
--      nothing and reports the score already recorded. The Education Engine
--      (study-prep/education-engine.js) scores; this function only writes,
--      reading the pass mark and attempt cap from the run in the same
--      transaction. Evidence goes through recordLearningEvent after commit.
-- Idempotent.
-- =============================================================

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'edu.study_prep_topics'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
       AND conname <> 'study_prep_topics_state_check'
  LOOP
    EXECUTE format('ALTER TABLE edu.study_prep_topics DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'edu.study_prep_topics'::regclass AND conname = 'study_prep_topics_state_check') THEN
    ALTER TABLE edu.study_prep_topics ADD CONSTRAINT study_prep_topics_state_check CHECK (status IN (
      'queued', 'active', 'diagnostic_ready', 'diagnostic', 'intervention_required', 'awaiting_teaching',
      'retest_ready', 'retest', 'understood', 'flagged_gap', 'capped_out', 'deferred'));
  END IF;
END $$;

ALTER TABLE edu.study_prep_topics
  ADD COLUMN IF NOT EXISTS teaching_workflow_id uuid;

-- Topics already under way move to the state their fields describe (only
-- "active" rows; re-running finds none left to move):
--   a check or practice out           → diagnostic | retest
--   checked, retest confirmed         → retest_ready
--   checked below the mark            → intervention_required
--   first check found no notes        → intervention_required
UPDATE edu.study_prep_topics t SET status = CASE
    WHEN t.check_battle_id IS NOT NULL AND t.check_scored_at IS NULL
      THEN CASE WHEN t.check_mode = 'retest' THEN 'retest' ELSE 'diagnostic' END
    WHEN t.check_battle_id IS NULL AND t.exam_prep_run_id IS NOT NULL AND r.status IN ('diagnostic_ready', 'retest_ready')
      THEN CASE WHEN r.status = 'retest_ready' THEN 'retest' ELSE 'diagnostic' END
    WHEN t.learner_confirmed_ready THEN 'retest_ready'
    WHEN t.check_scored_at IS NOT NULL OR r.status = 'teach_back_required' OR t.check_mode = 'skipped'
      THEN 'intervention_required'
    ELSE t.status END
  FROM edu.study_prep_topics t2
  LEFT JOIN edu.learner_exam_prep_runs r ON r.id = t2.exam_prep_run_id
 WHERE t.id = t2.id AND t.status = 'active'
   AND (t.check_battle_id IS NOT NULL OR t.exam_prep_run_id IS NOT NULL OR t.learner_confirmed_ready OR t.check_mode = 'skipped');

COMMENT ON COLUMN edu.study_prep_topics.status IS 'The topic state machine (Grand Plan §8.3). Moves are checked in code (TOPIC_TRANSITIONS).';
COMMENT ON COLUMN edu.study_prep_topics.teaching_workflow_id IS 'The Teaching Workflow this topic waits on while awaiting_teaching (D15).';

-- The auto-start sweep reads the topics that may start a check by themselves.
CREATE INDEX IF NOT EXISTS idx_study_prep_topics_startable
  ON edu.study_prep_topics (updated_at)
  WHERE status IN ('active', 'diagnostic_ready', 'retest_ready');

CREATE OR REPLACE FUNCTION edu.study_prep_submit_attempt(
  p_learner_id uuid,
  p_session_id uuid,
  p_topic_id   uuid,
  p_run_id     uuid,
  p_attempt_id uuid,
  p_submitted  jsonb,
  p_correct    integer,
  p_total      integer,
  p_score      numeric
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_topic   edu.study_prep_topics%ROWTYPE;
  v_run     edu.learner_exam_prep_runs%ROWTYPE;
  v_attempt edu.learner_exam_prep_attempts%ROWTYPE;
  v_passed  boolean;
  v_capped  boolean;
  v_topic_next text;
  v_run_next   text;
  v_now timestamptz := now();
BEGIN
  IF p_score IS NULL OR p_score < 0 OR p_score > 1 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_score');
  END IF;

  -- The topic, owned through its session, locked for the whole write.
  SELECT t.* INTO v_topic
    FROM edu.study_prep_topics t
    JOIN edu.study_prep_sessions s ON s.id = t.session_id
   WHERE t.id = p_topic_id AND t.session_id = p_session_id AND s.learner_id = p_learner_id
   FOR UPDATE OF t;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT r.* INTO v_run FROM edu.learner_exam_prep_runs r
   WHERE r.id = p_run_id AND r.learner_id = p_learner_id
   FOR UPDATE;
  IF NOT FOUND OR v_topic.exam_prep_run_id IS DISTINCT FROM p_run_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT a.* INTO v_attempt FROM edu.learner_exam_prep_attempts a
   WHERE a.id = p_attempt_id AND a.run_id = p_run_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- Idempotent: the attempt was already scored — one score, nothing changes.
  IF v_attempt.submitted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'applied', false, 'duplicate', true, 'code', 'attempt_already_submitted',
      'score', v_attempt.score, 'topic', to_jsonb(v_topic), 'run_status', v_run.status);
  END IF;

  -- The submit-status guard: only an attempt that is out, on a topic checking it.
  IF v_topic.status NOT IN ('diagnostic', 'retest') THEN
    RETURN jsonb_build_object('ok', false, 'applied', false, 'code', 'invalid_state_transition', 'topic', to_jsonb(v_topic));
  END IF;
  IF v_run.status NOT IN ('diagnostic_ready', 'retest_ready') OR v_attempt.attempt_number <> v_run.current_attempt THEN
    RETURN jsonb_build_object('ok', false, 'applied', false, 'code', 'attempt_not_ready', 'topic', to_jsonb(v_topic));
  END IF;

  v_passed := p_score >= v_run.pass_threshold;
  v_capped := NOT v_passed AND v_topic.attempts_used >= v_run.max_attempts;
  v_topic_next := CASE WHEN v_passed THEN 'understood' WHEN v_capped THEN 'capped_out' ELSE 'intervention_required' END;
  -- The run as a record (the standalone route's retest reads teach_back_required).
  v_run_next := CASE WHEN v_passed THEN 'passed'
                     WHEN v_run.current_attempt >= v_run.max_attempts THEN 'change_approach'
                     ELSE 'teach_back_required' END;

  UPDATE edu.learner_exam_prep_attempts
     SET submitted_answers = COALESCE(p_submitted, '{}'::jsonb), score = p_score, submitted_at = v_now
   WHERE id = v_attempt.id;

  UPDATE edu.learner_exam_prep_runs
     SET status = v_run_next, last_score = p_score, updated_at = v_now,
         completed_at = CASE WHEN v_passed THEN v_now ELSE NULL END
   WHERE id = v_run.id;

  UPDATE edu.study_prep_topics
     SET status = v_topic_next, learner_confirmed_ready = false, updated_at = v_now
   WHERE id = v_topic.id
  RETURNING * INTO v_topic;

  RETURN jsonb_build_object(
    'ok', true, 'applied', true, 'score', p_score, 'correct', p_correct, 'total', p_total,
    'passed', v_passed, 'capped', v_capped, 'run_status', v_run_next, 'topic', to_jsonb(v_topic));
END $$;

REVOKE ALL ON FUNCTION edu.study_prep_submit_attempt(uuid, uuid, uuid, uuid, uuid, jsonb, integer, integer, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION edu.study_prep_submit_attempt(uuid, uuid, uuid, uuid, uuid, jsonb, integer, integer, numeric) TO service_role;

COMMENT ON FUNCTION edu.study_prep_submit_attempt(uuid, uuid, uuid, uuid, uuid, jsonb, integer, integer, numeric) IS
  'Study Prep submit (Phase 5): attempt score + run record + topic outcome in one transaction, once. Returns {ok, applied, duplicate?, code?, score, passed, capped, run_status, topic}.';
