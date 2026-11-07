-- =============================================================
-- 2026-chat-model-selection.sql
-- Grand Plan §7.11.5, Scenario K: the learner's model pick is saved on the
-- chat thread (as workflow_instances.model_selection already is on a
-- workflow), so it applies from the next message and follows the learner to
-- another device. Shape: { modelId, label, resolved, source, notice, changedAt }.
-- Idempotent.
-- =============================================================
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS model_selection jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The learner's latest pick across their threads.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_model_pick
  ON public.chat_sessions (user_id, ((model_selection->>'changedAt')) DESC)
  WHERE model_selection ? 'changedAt';

NOTIFY pgrst, 'reload schema';
