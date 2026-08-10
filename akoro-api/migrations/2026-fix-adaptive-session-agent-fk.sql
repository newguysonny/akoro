-- ============================================================================
-- 2026-fix-adaptive-session-agent-fk.sql
--
-- WHY: edu.adaptive_sessions.student_agent_id was declared as
--        REFERENCES public.user_agents(id)
--      but every writer (websocket.js → createSessionRecord) fills it with
--      orchestrator.studentAgentRecord.id, which comes from
--      getOrCreateStudentAgent() → edu.student_agents(id).
--
--      Those are different tables, so EVERY session insert failed with a
--      foreign-key violation (23503). The failure was caught and logged, so
--      the live session kept working — but no row was ever written, which is
--      why a newly created session never appeared in the Sessions tab
--      (GET /api/adaptive/teaching/sessions reads this table).
--
-- FIX: repoint the FK at edu.student_agents(id). Idempotent: safe to re-run.
-- ============================================================================

DO $$
DECLARE
  con RECORD;
BEGIN
  IF to_regclass('edu.adaptive_sessions') IS NULL THEN
    RETURN;
  END IF;

  -- 1. Drop whatever FK currently sits on student_agent_id, whatever it is
  --    named and whatever it points at.
  FOR con IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'edu.adaptive_sessions'::regclass
       AND c.contype  = 'f'
       AND a.attname  = 'student_agent_id'
  LOOP
    EXECUTE format('ALTER TABLE edu.adaptive_sessions DROP CONSTRAINT %I', con.conname);
  END LOOP;

  -- 2. Null out any value that is not a real edu.student_agents id, so the
  --    new constraint can be added without a validation failure.
  IF to_regclass('edu.student_agents') IS NOT NULL THEN
    UPDATE edu.adaptive_sessions s
       SET student_agent_id = NULL
     WHERE s.student_agent_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM edu.student_agents a WHERE a.id = s.student_agent_id
       );

    -- 3. Add the correct FK.
    ALTER TABLE edu.adaptive_sessions
      ADD CONSTRAINT adaptive_sessions_student_agent_id_fkey
      FOREIGN KEY (student_agent_id)
      REFERENCES edu.student_agents(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN edu.adaptive_sessions.student_agent_id IS
  'The learner''s AI study agent — edu.student_agents(id). NOT public.user_agents.';
