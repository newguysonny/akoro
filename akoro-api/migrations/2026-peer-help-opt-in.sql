-- =============================================================
-- 2026-peer-help-opt-in.sql — Grand Plan §7.13.1a (D34): "Let my agent help
-- other learners". Off by default. While it is off, none of the learner's
-- breakthroughs is ever shown to another learner as a story; every record
-- still counts toward the anonymous pattern totals (shown only when at least
-- 5 learners match). Saved with the agent PUT (/api/user/agent); turning it
-- on or off also marks the learner's non-sensitive records shareable or not.
-- Idempotent.
-- =============================================================
ALTER TABLE public.user_agents ADD COLUMN IF NOT EXISTS help_others_opt_in boolean NOT NULL DEFAULT false;

-- Peer matching reads resolved breakthroughs by type + concept.
CREATE INDEX IF NOT EXISTS idx_learning_struggles_breakthroughs
  ON edu.learning_struggles (struggle_type, concept_id, resolved_at DESC)
  WHERE status = 'resolved';

NOTIFY pgrst, 'reload schema';
