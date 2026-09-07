-- =============================================================
-- 2026-python-agent-conversation-scratchpad-plan.sql
-- Adds compressed prior progress and an explicit bounded future plan to the
-- durable Python-agent scratchpad. Kept separate from the original scratchpad
-- migration so already-deployed environments upgrade safely.
-- =============================================================

ALTER TABLE edu.learner_agent_conversation_scratchpads
  ADD COLUMN IF NOT EXISTS progress_summary text NOT NULL DEFAULT ''
    CHECK (char_length(progress_summary) <= 1200),
  ADD COLUMN IF NOT EXISTS plan jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'learner_agent_scratchpad_plan_is_bounded_array'
      AND conrelid = 'edu.learner_agent_conversation_scratchpads'::regclass
  ) THEN
    ALTER TABLE edu.learner_agent_conversation_scratchpads
      ADD CONSTRAINT learner_agent_scratchpad_plan_is_bounded_array
      CHECK (CASE WHEN jsonb_typeof(plan) = 'array' THEN jsonb_array_length(plan) <= 6 ELSE false END);
  END IF;
END $$;
