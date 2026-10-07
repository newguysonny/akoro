-- Server-owned adaptive-teaching evidence.
--
-- This intentionally stores only bounded numeric/category evidence state, not
-- human message text, model rationales, or a duplicate transcript. The
-- canonical conversation remains in adaptive_sessions.block_history.

DO $$
BEGIN
  IF to_regclass('edu.adaptive_sessions') IS NOT NULL THEN
    ALTER TABLE edu.adaptive_sessions
      ADD COLUMN IF NOT EXISTS teaching_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

    COMMENT ON COLUMN edu.adaptive_sessions.teaching_evidence IS
      'Compact server-derived human teaching/protege evidence and temporary pace state; no transcript or LLM rationale.';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
