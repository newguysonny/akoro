-- =============================================================
-- 2026-learning-struggles.sql — Phase 4a slice 2 (§7.13.1, §7.15, D38).
-- One table for struggles and breakthroughs: a breakthrough is a resolved
-- struggle. Types come from struggleTypes.js (41, versioned); sensitive types
-- keep type + date only (no summary / what_worked); health_energy expires.
-- The school view (school/learnerStruggles.js) already reads these columns.
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.learning_struggles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category             TEXT NOT NULL,
  struggle_type        TEXT NOT NULL,
  types_version        INT NOT NULL DEFAULT 1,
  subject              TEXT,
  class_level          TEXT,
  concept_id           UUID REFERENCES edu.concept_catalog(id) ON DELETE SET NULL,
  topic_label          TEXT,
  detected_by          TEXT NOT NULL CHECK (detected_by IN ('rule', 'agent', 'learner')),
  detected_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_refs        TEXT[] NOT NULL DEFAULT '{}',
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'abandoned', 'expired')),
  struggle_summary     TEXT CHECK (char_length(struggle_summary) <= 200),
  misconception_key    TEXT,
  attempts_before      INT NOT NULL DEFAULT 0,
  strategies_tried     TEXT[] NOT NULL DEFAULT '{}',
  what_worked_strategy TEXT,
  what_worked          TEXT CHECK (char_length(what_worked) <= 300),
  score_before         NUMERIC,
  score_after          NUMERIC,
  days_to_overcome     INT,
  resolved_at          TIMESTAMPTZ,
  source_workflow      TEXT,
  sensitive            BOOLEAN NOT NULL DEFAULT false,
  shareable            BOOLEAN NOT NULL DEFAULT false,
  hidden               BOOLEAN NOT NULL DEFAULT false,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Sensitive rows never carry words about the learner.
  CHECK (NOT sensitive OR (struggle_summary IS NULL AND what_worked IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_learning_struggles_type ON edu.learning_struggles (struggle_type, concept_id, status);
CREATE INDEX IF NOT EXISTS idx_learning_struggles_learner ON edu.learning_struggles (learner_id, status);
-- At most one OPEN struggle per learner + type + concept: a repeat updates it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_struggles_open
  ON edu.learning_struggles (learner_id, struggle_type, COALESCE(concept_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'open';
GRANT ALL ON edu.learning_struggles TO service_role;
