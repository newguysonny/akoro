-- ============================================================================
-- 2026-curriculum-guardian-review-v1.sql
-- Minimal human-review queue for Guardian-supported contradictions. No learner
-- transcript, model rationale, evidence quote, or raw tool output is copied.
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.curriculum_guardian_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  concept_id UUID NOT NULL REFERENCES edu.concept_catalog(id) ON DELETE CASCADE,
  source_session_id TEXT NOT NULL CHECK (char_length(source_session_id) BETWEEN 1 AND 180),
  source_turn_id TEXT NOT NULL CHECK (char_length(source_turn_id) BETWEEN 1 AND 180),
  review_reason TEXT NOT NULL CHECK (review_reason IN ('contradicted_claim')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolution TEXT CHECK (char_length(resolution) <= 600),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE (learner_id, concept_id, source_session_id, source_turn_id, review_reason)
);
CREATE INDEX IF NOT EXISTS idx_curriculum_guardian_reviews_open
  ON edu.curriculum_guardian_reviews (status, created_at ASC) WHERE status = 'open';

GRANT USAGE ON SCHEMA edu TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON edu.curriculum_guardian_reviews TO service_role;
NOTIFY pgrst, 'reload schema';
