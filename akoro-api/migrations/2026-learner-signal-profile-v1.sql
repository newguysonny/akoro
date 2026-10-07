-- ============================================================================
-- 2026-learner-signal-profile-v1.sql
-- Bounded, learner-owned study measurements for the additive Python adaptive
-- service. These are not transcript storage and cannot be used as a source of
-- curriculum truth or an autonomous-action trigger.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS edu;

-- One completed teaching turn may yield at most one conservative observation.
-- It contains aggregate scores and a small categorical label only: never the
-- learner's original message, a model chain of thought, tool output, account
-- data, or an inferred diagnosis.
CREATE TABLE IF NOT EXISTS edu.learner_turn_measurements (
  learner_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_session_id    TEXT NOT NULL CHECK (char_length(source_session_id) BETWEEN 1 AND 180),
  source_turn_id       TEXT NOT NULL CHECK (char_length(source_turn_id) BETWEEN 1 AND 180),
  attention            NUMERIC(5,4) NOT NULL CHECK (attention >= 0 AND attention <= 1),
  fatigue              NUMERIC(5,4) NOT NULL CHECK (fatigue >= 0 AND fatigue <= 1),
  reasoning_quality    NUMERIC(5,4) NOT NULL CHECK (reasoning_quality >= 0 AND reasoning_quality <= 1),
  reasoning_style      TEXT NOT NULL CHECK (reasoning_style IN (
                          'not_observed', 'recall', 'procedural', 'causal',
                          'comparative', 'transfer', 'mixed')),
  measurement_status   TEXT NOT NULL CHECK (measurement_status IN ('observed', 'not_checked')),
  policy_version       TEXT NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  observed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, source_session_id, source_turn_id)
);

CREATE INDEX IF NOT EXISTS idx_learner_turn_measurements_recent
  ON edu.learner_turn_measurements (learner_id, observed_at DESC);

-- A slow-moving profile is derived only from a rolling window of observed
-- turns. It is intentionally not a permanent learner label and has no free
-- text field. Confidence makes sparse evidence visibly non-actionable.
CREATE TABLE IF NOT EXISTS edu.learner_teaching_profiles (
  learner_id             UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  evidence_count         INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  profile_confidence     NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (profile_confidence >= 0 AND profile_confidence <= 1),
  mean_attention         NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (mean_attention >= 0 AND mean_attention <= 1),
  mean_fatigue           NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (mean_fatigue >= 0 AND mean_fatigue <= 1),
  mean_reasoning_quality NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (mean_reasoning_quality >= 0 AND mean_reasoning_quality <= 1),
  reasoning_style        TEXT NOT NULL DEFAULT 'not_observed' CHECK (reasoning_style IN (
                            'not_observed', 'recall', 'procedural', 'causal',
                            'comparative', 'transfer', 'mixed')),
  pacing_recommendation  TEXT NOT NULL DEFAULT 'unknown' CHECK (pacing_recommendation IN (
                            'unknown', 'shorter_chunks', 'steady', 'stretch')),
  policy_version         TEXT NOT NULL DEFAULT 'learner-signals-v1' CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  calculated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at             TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '45 days'),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- These small resume cues are deterministic descriptions of verified workflow
-- progress. They deliberately do not copy chat text. Storage is capped by the
-- recording function so episode history stays compact and clearable.
CREATE TABLE IF NOT EXISTS edu.learner_learning_episodes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_session_id    TEXT NOT NULL CHECK (char_length(source_session_id) BETWEEN 1 AND 180),
  source_turn_id       TEXT NOT NULL CHECK (char_length(source_turn_id) BETWEEN 1 AND 180),
  concept_id           UUID REFERENCES edu.concept_catalog(id) ON DELETE SET NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('verified_progress', 'misconception_repaired', 'retrieval_practice')),
  summary              TEXT NOT NULL CHECK (char_length(summary) BETWEEN 3 AND 420),
  policy_version       TEXT NOT NULL CHECK (char_length(policy_version) BETWEEN 1 AND 80),
  occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (learner_id, source_session_id, source_turn_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_learner_learning_episodes_recent
  ON edu.learner_learning_episodes (learner_id, occurred_at DESC);

-- Record an idempotent turn then rebuild its small, explainable aggregate from
-- the latest 12 observed turns. A single noisy event therefore cannot label or
-- materially steer a learner's teaching experience.
CREATE OR REPLACE FUNCTION edu.record_learner_turn_measurement(
  p_learner_id UUID,
  p_source_session_id TEXT,
  p_source_turn_id TEXT,
  p_attention NUMERIC,
  p_fatigue NUMERIC,
  p_reasoning_quality NUMERIC,
  p_reasoning_style TEXT,
  p_measurement_status TEXT,
  p_policy_version TEXT DEFAULT 'learner-signals-v1',
  p_observed_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  evidence_count INTEGER,
  profile_confidence NUMERIC,
  mean_attention NUMERIC,
  mean_fatigue NUMERIC,
  mean_reasoning_quality NUMERIC,
  reasoning_style TEXT,
  pacing_recommendation TEXT,
  policy_version TEXT,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = edu, public
AS $function$
DECLARE
  v_count INTEGER;
  v_attention NUMERIC(5,4);
  v_fatigue NUMERIC(5,4);
  v_reasoning NUMERIC(5,4);
  v_style TEXT;
  v_pacing TEXT;
  v_confidence NUMERIC(5,4);
BEGIN
  INSERT INTO edu.learner_turn_measurements (
    learner_id, source_session_id, source_turn_id, attention, fatigue,
    reasoning_quality, reasoning_style, measurement_status, policy_version, observed_at
  ) VALUES (
    p_learner_id, p_source_session_id, p_source_turn_id,
    p_attention, p_fatigue, p_reasoning_quality, p_reasoning_style,
    p_measurement_status, p_policy_version, COALESCE(p_observed_at, now())
  ) ON CONFLICT (learner_id, source_session_id, source_turn_id) DO NOTHING;

  WITH recent AS (
    SELECT attention, fatigue, reasoning_quality, reasoning_style
    FROM edu.learner_turn_measurements
    WHERE learner_id = p_learner_id AND measurement_status = 'observed'
    ORDER BY observed_at DESC
    LIMIT 12
  ), aggregate AS (
    SELECT count(*)::INTEGER AS evidence_count,
           COALESCE(avg(attention), 0)::NUMERIC(5,4) AS mean_attention,
           COALESCE(avg(fatigue), 0)::NUMERIC(5,4) AS mean_fatigue,
           COALESCE(avg(reasoning_quality), 0)::NUMERIC(5,4) AS mean_reasoning
    FROM recent
  ), dominant_style AS (
    SELECT reasoning_style
    FROM recent
    WHERE reasoning_style <> 'not_observed'
    GROUP BY reasoning_style
    ORDER BY count(*) DESC, reasoning_style ASC
    LIMIT 1
  )
  SELECT aggregate.evidence_count, aggregate.mean_attention, aggregate.mean_fatigue,
         aggregate.mean_reasoning, COALESCE(dominant_style.reasoning_style, 'not_observed')
    INTO v_count, v_attention, v_fatigue, v_reasoning, v_style
    FROM aggregate LEFT JOIN dominant_style ON true;

  v_confidence := LEAST(1, v_count::NUMERIC / 6);
  v_pacing := CASE
    WHEN v_count < 3 THEN 'unknown'
    WHEN v_fatigue >= 0.65 OR v_attention < 0.40 THEN 'shorter_chunks'
    WHEN v_attention >= 0.72 AND v_reasoning >= 0.65 AND v_fatigue < 0.45 THEN 'stretch'
    ELSE 'steady'
  END;

  INSERT INTO edu.learner_teaching_profiles (
    learner_id, evidence_count, profile_confidence, mean_attention, mean_fatigue,
    mean_reasoning_quality, reasoning_style, pacing_recommendation, policy_version,
    calculated_at, expires_at, updated_at
  ) VALUES (
    p_learner_id, v_count, v_confidence, v_attention, v_fatigue, v_reasoning,
    v_style, v_pacing, p_policy_version, now(), now() + interval '45 days', now()
  ) ON CONFLICT (learner_id) DO UPDATE SET
    evidence_count = EXCLUDED.evidence_count,
    profile_confidence = EXCLUDED.profile_confidence,
    mean_attention = EXCLUDED.mean_attention,
    mean_fatigue = EXCLUDED.mean_fatigue,
    mean_reasoning_quality = EXCLUDED.mean_reasoning_quality,
    reasoning_style = EXCLUDED.reasoning_style,
    pacing_recommendation = EXCLUDED.pacing_recommendation,
    policy_version = EXCLUDED.policy_version,
    calculated_at = EXCLUDED.calculated_at,
    expires_at = EXCLUDED.expires_at,
    updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT p.evidence_count, p.profile_confidence, p.mean_attention,
    p.mean_fatigue, p.mean_reasoning_quality, p.reasoning_style,
    p.pacing_recommendation, p.policy_version, p.expires_at
  FROM edu.learner_teaching_profiles p WHERE p.learner_id = p_learner_id;
END;
$function$;

CREATE OR REPLACE FUNCTION edu.record_learner_learning_episode(
  p_learner_id UUID,
  p_source_session_id TEXT,
  p_source_turn_id TEXT,
  p_concept_id UUID,
  p_kind TEXT,
  p_summary TEXT,
  p_policy_version TEXT DEFAULT 'learner-signals-v1'
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = edu, public
AS $function$
BEGIN
  INSERT INTO edu.learner_learning_episodes (
    learner_id, source_session_id, source_turn_id, concept_id, kind, summary, policy_version
  ) VALUES (
    p_learner_id, p_source_session_id, p_source_turn_id, p_concept_id, p_kind, p_summary, p_policy_version
  ) ON CONFLICT (learner_id, source_session_id, source_turn_id, kind) DO NOTHING;

  DELETE FROM edu.learner_learning_episodes
  WHERE id IN (
    SELECT id FROM edu.learner_learning_episodes
    WHERE learner_id = p_learner_id
    ORDER BY occurred_at DESC, created_at DESC
    OFFSET 60
  );
END;
$function$;

GRANT USAGE ON SCHEMA edu TO service_role;
GRANT SELECT, INSERT, DELETE ON edu.learner_turn_measurements TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.learner_teaching_profiles TO service_role;
GRANT SELECT, INSERT, DELETE ON edu.learner_learning_episodes TO service_role;
GRANT EXECUTE ON FUNCTION edu.record_learner_turn_measurement(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION edu.record_learner_learning_episode(UUID, TEXT, TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
