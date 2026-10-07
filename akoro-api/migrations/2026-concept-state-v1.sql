-- ============================================================================
-- 2026-concept-state-v1.sql
-- Akoro-owned, curriculum-grounded concept state for the additive Python
-- adaptive-learning service.
--
-- This is deliberately separate from the legacy JSON student state and from
-- edu.student_knowledge / edu.knowledge_confidence. Those tables continue to
-- serve their existing products and keep their documented confidence units.
-- The new contract stores fractions (0..1) exclusively and is populated only
-- through reviewed curriculum concepts plus immutable evidence.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS edu;

-- A concept becomes available to the cognitive engine only after a source has
-- been approved. `source_ref` is structured provenance (for example an owned
-- scheme-of-work id, reviewed curriculum reference, and revision), never an
-- arbitrary search result or a model-generated claim.
CREATE TABLE IF NOT EXISTS edu.concept_catalog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_key  TEXT NOT NULL CHECK (char_length(curriculum_key) BETWEEN 1 AND 180),
  subject         TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 180),
  topic_key       TEXT NOT NULL CHECK (char_length(topic_key) BETWEEN 1 AND 180),
  code            TEXT NOT NULL CHECK (code ~ '^[A-Za-z0-9._:-]{1,120}$'),
  title           TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  objective       TEXT NOT NULL CHECK (char_length(objective) BETWEEN 3 AND 1200),
  grade_band      TEXT CHECK (char_length(grade_band) <= 120),
  source_type     TEXT NOT NULL CHECK (source_type IN (
                    'scheme_of_work', 'curriculum', 'reviewed_content', 'assessment')),
  source_ref      JSONB NOT NULL CHECK (jsonb_typeof(source_ref) = 'object' AND source_ref <> '{}'::jsonb),
  status          TEXT NOT NULL DEFAULT 'pending_review'
                  CHECK (status IN ('pending_review', 'approved', 'retired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (curriculum_key, code)
);

CREATE INDEX IF NOT EXISTS idx_concept_catalog_active_scope
  ON edu.concept_catalog (subject, topic_key, curriculum_key)
  WHERE status = 'approved';

-- Directed edges make prerequisite assumptions inspectable instead of hiding
-- them in an LLM prompt. The database check prevents trivial self-dependencies;
-- import/review tooling remains responsible for rejecting larger cycles.
CREATE TABLE IF NOT EXISTS edu.concept_edges (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_concept_id   UUID NOT NULL REFERENCES edu.concept_catalog(id) ON DELETE CASCADE,
  to_concept_id     UUID NOT NULL REFERENCES edu.concept_catalog(id) ON DELETE CASCADE,
  relation          TEXT NOT NULL CHECK (relation IN ('prerequisite_for', 'supports', 'related_to')),
  source_ref        JSONB NOT NULL CHECK (jsonb_typeof(source_ref) = 'object' AND source_ref <> '{}'::jsonb),
  status            TEXT NOT NULL DEFAULT 'pending_review'
                    CHECK (status IN ('pending_review', 'approved', 'retired')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_concept_id <> to_concept_id),
  UNIQUE (from_concept_id, to_concept_id, relation)
);

CREATE INDEX IF NOT EXISTS idx_concept_edges_to_active
  ON edu.concept_edges (to_concept_id, relation)
  WHERE status = 'approved';

-- The durable learner/protege cognitive state. All numeric dimensions are
-- fractions, not percentages. A learner's transient chat tone, raw transcript,
-- and unbounded model reasoning are intentionally not stored here.
CREATE TABLE IF NOT EXISTS edu.learner_concept_state (
  learner_id              UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  concept_id              UUID NOT NULL REFERENCES edu.concept_catalog(id) ON DELETE CASCADE,
  mastery                 NUMERIC(5,4) NOT NULL DEFAULT 0
                          CHECK (mastery >= 0 AND mastery <= 1),
  retention               NUMERIC(5,4) NOT NULL DEFAULT 0
                          CHECK (retention >= 0 AND retention <= 1),
  evidence_confidence     NUMERIC(5,4) NOT NULL DEFAULT 0
                          CHECK (evidence_confidence >= 0 AND evidence_confidence <= 1),
  misconception_active    BOOLEAN NOT NULL DEFAULT false,
  evidence_count          INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  last_evidence_at        TIMESTAMPTZ,
  next_review_due         TIMESTAMPTZ,
  state_version           INTEGER NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_concept_state_review_due
  ON edu.learner_concept_state (learner_id, next_review_due)
  WHERE next_review_due IS NOT NULL;

-- Evidence is append-only. It deliberately records separately: demonstrated
-- response quality, validation of the factual claim, and model confidence.
-- A confident model therefore cannot silently become evidence of mastery.
CREATE TABLE IF NOT EXISTS edu.learner_concept_evidence (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  concept_id            UUID NOT NULL REFERENCES edu.concept_catalog(id) ON DELETE CASCADE,
  source_session_id     TEXT NOT NULL CHECK (char_length(source_session_id) BETWEEN 1 AND 180),
  source_turn_id        TEXT NOT NULL CHECK (char_length(source_turn_id) BETWEEN 1 AND 180),
  observation_kind      TEXT NOT NULL CHECK (observation_kind IN (
                          'demonstrated_understanding', 'partial_understanding',
                          'recall_success', 'recall_gap', 'misconception_detected',
                          'misconception_cleared', 'assessment_result')),
  response_quality      NUMERIC(5,4) NOT NULL CHECK (response_quality >= 0 AND response_quality <= 1),
  claim_validity        NUMERIC(5,4) NOT NULL CHECK (claim_validity >= 0 AND claim_validity <= 1),
  model_confidence      NUMERIC(5,4) NOT NULL CHECK (model_confidence >= 0 AND model_confidence <= 1),
  claim_status          TEXT NOT NULL CHECK (claim_status IN ('supported', 'contradicted', 'not_checked')),
  evidence_summary      TEXT NOT NULL CHECK (char_length(evidence_summary) BETWEEN 1 AND 1200),
  provenance            JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (learner_id, source_session_id, source_turn_id, concept_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_concept_evidence_concept
  ON edu.learner_concept_evidence (learner_id, concept_id, observed_at DESC);

-- One canonical transition policy runs where the durable data lives. A model
-- sends a bounded observation only; it never sends a state delta. Supported
-- evidence can improve mastery, contradicted evidence can surface a
-- misconception, and unvalidated evidence remains in the audit ledger without
-- changing the learner state. The UPSERT row lock makes concurrent retries and
-- sessions converge on one state.
CREATE OR REPLACE FUNCTION edu.record_learner_concept_evidence(
  p_learner_id UUID,
  p_concept_id UUID,
  p_source_session_id TEXT,
  p_source_turn_id TEXT,
  p_observation_kind TEXT,
  p_response_quality NUMERIC,
  p_claim_validity NUMERIC,
  p_model_confidence NUMERIC,
  p_claim_status TEXT,
  p_evidence_summary TEXT,
  p_provenance JSONB DEFAULT '{}'::jsonb,
  p_observed_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  learner_id UUID,
  concept_id UUID,
  mastery NUMERIC,
  retention NUMERIC,
  evidence_confidence NUMERIC,
  misconception_active BOOLEAN,
  evidence_count INTEGER,
  last_evidence_at TIMESTAMPTZ,
  next_review_due TIMESTAMPTZ,
  state_version INTEGER
)
LANGUAGE plpgsql
SET search_path = edu, public
AS $function$
DECLARE
  inserted_count INTEGER;
  supported_signal NUMERIC(5,4);
  review_days INTEGER;
  effective_observed_at TIMESTAMPTZ := COALESCE(p_observed_at, now());
BEGIN
  -- The gateway verifies active approved concept membership before calling this
  -- function. This extra check keeps a direct service-role call from attaching
  -- learner evidence to retired or unreviewed content.
  IF NOT EXISTS (
    SELECT 1 FROM edu.concept_catalog
    WHERE id = p_concept_id AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Concept is not approved for cognitive state';
  END IF;

  INSERT INTO edu.learner_concept_evidence (
    learner_id, concept_id, source_session_id, source_turn_id, observation_kind,
    response_quality, claim_validity, model_confidence, claim_status,
    evidence_summary, provenance, observed_at
  ) VALUES (
    p_learner_id, p_concept_id, p_source_session_id, p_source_turn_id, p_observation_kind,
    p_response_quality, p_claim_validity, p_model_confidence, p_claim_status,
    p_evidence_summary, COALESCE(p_provenance, '{}'::jsonb), effective_observed_at
  ) ON CONFLICT (learner_id, source_session_id, source_turn_id, concept_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count = 0 THEN
    -- A duplicate of a first `not_checked` event has no state row by design.
    -- It must still replay to the same zero/default public projection instead
    -- of looking like a failed write to the Python client.
    RETURN QUERY
      SELECT s.learner_id, s.concept_id, s.mastery, s.retention,
             s.evidence_confidence, s.misconception_active, s.evidence_count,
             s.last_evidence_at, s.next_review_due, s.state_version
      FROM edu.learner_concept_state s
      WHERE s.learner_id = p_learner_id AND s.concept_id = p_concept_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT p_learner_id, p_concept_id, 0::NUMERIC, 0::NUMERIC,
        0::NUMERIC, false, 0, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, 1;
    END IF;
    RETURN;
  END IF;

  -- Keep unvalidated observations in the immutable evidence ledger, but do
  -- not create or change a cognitive-state row from them. Return an existing
  -- state, or a read-only zero/default projection when this is the first
  -- observation, so callers still receive a stable wire shape.
  IF p_claim_status = 'not_checked' THEN
    RETURN QUERY
      SELECT s.learner_id, s.concept_id, s.mastery, s.retention,
             s.evidence_confidence, s.misconception_active, s.evidence_count,
             s.last_evidence_at, s.next_review_due, s.state_version
      FROM edu.learner_concept_state s
      WHERE s.learner_id = p_learner_id AND s.concept_id = p_concept_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT p_learner_id, p_concept_id, 0::NUMERIC, 0::NUMERIC,
        0::NUMERIC, false, 0, NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, 1;
    END IF;
    RETURN;
  END IF;

  supported_signal := GREATEST(0, LEAST(1,
    (p_response_quality * 0.55) + (p_claim_validity * 0.30) + (p_model_confidence * 0.15)
  ));
  review_days := CASE
    WHEN supported_signal < 0.35 THEN 1
    WHEN supported_signal < 0.55 THEN 3
    WHEN supported_signal < 0.75 THEN 7
    ELSE 14
  END;

  INSERT INTO edu.learner_concept_state AS current (
    learner_id, concept_id, mastery, retention, evidence_confidence,
    misconception_active, evidence_count, last_evidence_at, next_review_due
  ) VALUES (
    p_learner_id,
    p_concept_id,
    CASE WHEN p_claim_status = 'supported' THEN ROUND(supported_signal * 0.28, 4) ELSE 0 END,
    CASE WHEN p_claim_status = 'supported' THEN ROUND(p_response_quality * 0.32, 4) ELSE 0 END,
    ROUND(p_model_confidence * 0.20, 4),
    p_observation_kind = 'misconception_detected',
    1,
    effective_observed_at,
    CASE WHEN p_claim_status = 'supported' THEN effective_observed_at + make_interval(days => review_days) ELSE NULL END
  ) ON CONFLICT (learner_id, concept_id) DO UPDATE SET
    mastery = CASE
      WHEN p_claim_status = 'supported' THEN ROUND(LEAST(1, (current.mastery * 0.72) + (supported_signal * 0.28)), 4)
      WHEN p_claim_status = 'contradicted' THEN ROUND(GREATEST(0, current.mastery * 0.92), 4)
      ELSE current.mastery
    END,
    retention = CASE
      WHEN p_claim_status = 'supported' THEN ROUND(LEAST(1, (current.retention * 0.68) + (p_response_quality * 0.32)), 4)
      WHEN p_claim_status = 'contradicted' THEN ROUND(GREATEST(0, current.retention * 0.96), 4)
      ELSE current.retention
    END,
    evidence_confidence = ROUND(LEAST(1, (current.evidence_confidence * 0.80) + (p_model_confidence * 0.20)), 4),
    misconception_active = CASE
      WHEN p_observation_kind = 'misconception_detected' THEN true
      WHEN p_observation_kind = 'misconception_cleared' AND p_claim_status = 'supported' AND p_claim_validity >= 0.75 THEN false
      ELSE current.misconception_active
    END,
    evidence_count = current.evidence_count + 1,
    last_evidence_at = effective_observed_at,
    next_review_due = CASE
      WHEN p_claim_status = 'supported' THEN effective_observed_at + make_interval(days => review_days)
      ELSE current.next_review_due
    END,
    state_version = current.state_version + 1,
    updated_at = now()
  RETURNING current.learner_id, current.concept_id, current.mastery, current.retention,
            current.evidence_confidence, current.misconception_active, current.evidence_count,
            current.last_evidence_at, current.next_review_due, current.state_version
  INTO learner_id, concept_id, mastery, retention, evidence_confidence,
       misconception_active, evidence_count, last_evidence_at, next_review_due, state_version;

  RETURN NEXT;
END;
$function$;

COMMENT ON TABLE edu.learner_concept_state IS
  'Canonical concept cognitive state. Score fields mastery, retention, and evidence_confidence are FRACTIONS 0..1; count/version fields are integers. This is separate from edu.knowledge_confidence (assessment percent 0..100) and edu.student_knowledge (retrieval weighting fraction 0..1).';
COMMENT ON TABLE edu.learner_concept_evidence IS
  'Append-only, idempotent concept evidence. It stores quality, factual validity, and model confidence separately; raw chat/tool output is not stored.';
COMMENT ON FUNCTION edu.record_learner_concept_evidence IS
  'Deterministic bounded transition policy for an approved curriculum concept. Model output is an observation, never a direct state mutation.';

GRANT ALL ON edu.concept_catalog, edu.concept_edges, edu.learner_concept_state,
  edu.learner_concept_evidence TO service_role;
GRANT EXECUTE ON FUNCTION edu.record_learner_concept_evidence(
  UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, JSONB, TIMESTAMPTZ
) TO service_role;
