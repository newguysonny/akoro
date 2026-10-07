-- ============================================================================
-- 2026-concept-state-retention-v1.sql
-- Retention refresh for the canonical concept-state slice.
--
-- This reuses the existing student-agent decay curve: 10% base daily decay,
-- slower at higher retention, and a 5% floor. It intentionally changes only the
-- new fraction-based `retention` field; legacy topic confidence and assessment
-- percentages retain their existing ownership and units.
-- ============================================================================

ALTER TABLE edu.learner_concept_state
  ADD COLUMN IF NOT EXISTS last_retention_decay_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS edu.learner_concept_retention_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id            UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  concept_id            UUID NOT NULL REFERENCES edu.concept_catalog(id) ON DELETE CASCADE,
  prior_retention       NUMERIC(5,4) NOT NULL CHECK (prior_retention >= 0 AND prior_retention <= 1),
  resulting_retention   NUMERIC(5,4) NOT NULL CHECK (resulting_retention >= 0 AND resulting_retention <= 1),
  elapsed_whole_days    INTEGER NOT NULL CHECK (elapsed_whole_days >= 1 AND elapsed_whole_days <= 3660),
  base_decay_rate       NUMERIC(5,4) NOT NULL CHECK (base_decay_rate >= 0 AND base_decay_rate <= 1),
  retention_multiplier  NUMERIC(5,4) NOT NULL CHECK (retention_multiplier >= 0 AND retention_multiplier <= 1),
  calculated_at         TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A refresh is idempotent for the same state baseline and calculation instant.
  UNIQUE (learner_id, concept_id, calculated_at)
);

CREATE INDEX IF NOT EXISTS idx_learner_concept_retention_events_lookup
  ON edu.learner_concept_retention_events (learner_id, concept_id, calculated_at DESC);

-- This function is invoked by the trusted concept-state gateway immediately
-- before a bounded snapshot. It is deliberately a state refresh, not a learner
-- task or notification. A row's last_retention_decay_at moves forward only
-- after at least one full elapsed day, so repeated reads do not compound decay.
CREATE OR REPLACE FUNCTION edu.refresh_learner_concept_retention(
  p_learner_id UUID,
  p_concept_ids UUID[],
  p_calculated_at TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  concept_id UUID,
  retention NUMERIC,
  last_retention_decay_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = edu, public
AS $function$
DECLARE
  current_row edu.learner_concept_state%ROWTYPE;
  baseline TIMESTAMPTZ;
  effective_at TIMESTAMPTZ := COALESCE(p_calculated_at, now());
  elapsed_days INTEGER;
  multiplier NUMERIC(5,4);
  prior_value NUMERIC(5,4);
  resulting_value NUMERIC(5,4);
BEGIN
  IF p_learner_id IS NULL OR p_concept_ids IS NULL
     OR cardinality(p_concept_ids) < 1 OR cardinality(p_concept_ids) > 8
     OR cardinality(ARRAY(SELECT DISTINCT unnest(p_concept_ids))) <> cardinality(p_concept_ids) THEN
    RAISE EXCEPTION 'A unique bounded learner concept scope is required';
  END IF;

  FOR current_row IN
    SELECT s.* FROM edu.learner_concept_state s
    JOIN edu.concept_catalog c ON c.id = s.concept_id AND c.status = 'approved'
    WHERE s.learner_id = p_learner_id AND s.concept_id = ANY(p_concept_ids)
    FOR UPDATE OF s
  LOOP
    baseline := COALESCE(current_row.last_retention_decay_at, current_row.last_evidence_at, current_row.created_at);
    elapsed_days := LEAST(3660, FLOOR(EXTRACT(EPOCH FROM (effective_at - baseline)) / 86400)::INTEGER);
    IF elapsed_days < 1 THEN
      concept_id := current_row.concept_id;
      retention := current_row.retention;
      last_retention_decay_at := current_row.last_retention_decay_at;
      RETURN NEXT;
      CONTINUE;
    END IF;

    multiplier := CASE
      WHEN current_row.retention < 0.20 THEN 1.00
      WHEN current_row.retention < 0.40 THEN 0.85
      WHEN current_row.retention < 0.60 THEN 0.70
      WHEN current_row.retention < 0.80 THEN 0.55
      ELSE 0.40
    END;
    prior_value := current_row.retention;
    resulting_value := ROUND(GREATEST(0.05, LEAST(0.98,
      prior_value - (0.10 * multiplier * elapsed_days)
    )), 4);

    UPDATE edu.learner_concept_state AS target
    SET retention = resulting_value,
        last_retention_decay_at = effective_at,
        state_version = target.state_version + 1,
        updated_at = now()
    WHERE target.learner_id = p_learner_id AND target.concept_id = current_row.concept_id;

    INSERT INTO edu.learner_concept_retention_events (
      learner_id, concept_id, prior_retention, resulting_retention,
      elapsed_whole_days, base_decay_rate, retention_multiplier, calculated_at
    ) VALUES (
      p_learner_id, current_row.concept_id, prior_value, resulting_value,
      elapsed_days, 0.10, multiplier, effective_at
    ) ON CONFLICT (learner_id, concept_id, calculated_at) DO NOTHING;

    concept_id := current_row.concept_id;
    retention := resulting_value;
    last_retention_decay_at := effective_at;
    RETURN NEXT;
  END LOOP;
END;
$function$;

COMMENT ON TABLE edu.learner_concept_retention_events IS
  'Append-only audit of canonical concept retention refreshes. It matches the established topic decay curve but does not alter legacy confidence tables.';
COMMENT ON FUNCTION edu.refresh_learner_concept_retention IS
  'Refreshes a bounded learner concept scope using the existing base 0.10/day decay policy. Repeated same-day snapshots do not compound state.';

GRANT ALL ON edu.learner_concept_retention_events TO service_role;
GRANT EXECUTE ON FUNCTION edu.refresh_learner_concept_retention(UUID, UUID[], TIMESTAMPTZ) TO service_role;

-- Let hosted/self-hosted PostgREST discover the new RPC on the next request.
NOTIFY pgrst, 'reload schema';
