-- =============================================================
-- 2026-agent-knowledge-retention.sql
-- Grand Plan D44: one forgetting curve — the protégé's knowledge, per topic →
-- per concept (edu.agent_knowledge rows are keyed agent + topic + subtopic;
-- the subtopic is the concept). Each concept decays on its own, slowly:
--
--   current = learned_confidence × e^(−days since learned_at ÷ stability_days)
--
-- learned_confidence is what the concept stood at when last taught/reviewed;
-- stability_days starts at 45 and grows with every good review. The nightly
-- pass recomputes `confidence` from these (it used to decay the already
-- decayed value again each night, so forgetting accelerated). Idempotent.
-- =============================================================
ALTER TABLE edu.agent_knowledge
  ADD COLUMN IF NOT EXISTS learned_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS learned_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stability_days     NUMERIC DEFAULT 45;

-- Existing rows continue from where they stand today: their confidence was
-- already (over-)decayed by the old nightly pass, so the curve starts now
-- rather than decaying them again from their old last_seen_at.
UPDATE edu.agent_knowledge
   SET learned_confidence = COALESCE(confidence, 0.5), learned_at = now()
 WHERE learned_confidence IS NULL;
UPDATE edu.agent_knowledge SET stability_days = 45 WHERE stability_days IS NULL;

-- One alert per topic now names the concepts that faded.
ALTER TABLE edu.decay_notifications
  ADD COLUMN IF NOT EXISTS concepts JSONB NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
