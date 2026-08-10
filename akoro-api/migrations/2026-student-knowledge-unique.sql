-- ============================================================================
-- 2026-student-knowledge-unique.sql
--
-- WHY: saveStudentKnowledge() upserts with
--        { onConflict: "student_id,topic" }
--      but edu.student_knowledge has no unique constraint on (student_id, topic),
--      so every call failed with 42P10:
--        "there is no unique or exclusion constraint matching the ON CONFLICT
--         specification"
--      Both callers swallow the error (agent.js logs a warning, chat.js 500s),
--      so the learner's knowledge bank was never written by a teaching session.
--
-- FIX: dedupe, then add the constraint the upsert already assumes.
--      Idempotent — safe to re-run on every deploy.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('edu.student_knowledge') IS NULL THEN
    RETURN;
  END IF;

  -- 1. Collapse any pre-existing duplicates: keep the most recently updated row
  --    per (student_id, topic), and don't lose the losers' text — append it so a
  --    dedupe can never silently delete something a learner was taught.
  WITH ranked AS (
    SELECT id, student_id, topic, content,
           row_number() OVER (
             PARTITION BY student_id, topic
             ORDER BY updated_at DESC NULLS LAST, length(content) DESC, id
           ) AS rn
      FROM edu.student_knowledge
  ),
  merged AS (
    SELECT k.student_id, k.topic,
           string_agg(l.content, E'\n\n' ORDER BY l.rn) AS extra
      FROM ranked k
      JOIN ranked l
        ON l.student_id = k.student_id AND l.topic = k.topic AND l.rn > 1
     WHERE k.rn = 1
     GROUP BY k.student_id, k.topic
  )
  UPDATE edu.student_knowledge s
     SET content    = left(s.content || E'\n\n' || m.extra, 8000),
         updated_at = now()
    FROM merged m
   WHERE s.student_id = m.student_id
     AND s.topic      = m.topic
     AND s.id = (
       SELECT id FROM edu.student_knowledge x
        WHERE x.student_id = m.student_id AND x.topic = m.topic
        ORDER BY x.updated_at DESC NULLS LAST, length(x.content) DESC, x.id
        LIMIT 1
     );

  DELETE FROM edu.student_knowledge s
   USING (
     SELECT id, row_number() OVER (
              PARTITION BY student_id, topic
              ORDER BY updated_at DESC NULLS LAST, length(content) DESC, id
            ) AS rn
       FROM edu.student_knowledge
   ) d
   WHERE d.id = s.id AND d.rn > 1;

  -- 2. Add the constraint the upsert targets.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'edu.student_knowledge'::regclass
       AND conname  = 'student_knowledge_student_topic_key'
  ) THEN
    ALTER TABLE edu.student_knowledge
      ADD CONSTRAINT student_knowledge_student_topic_key
      UNIQUE (student_id, topic);
  END IF;
END $$;

COMMENT ON CONSTRAINT student_knowledge_student_topic_key ON edu.student_knowledge IS
  'One knowledge row per learner per topic — the target of saveStudentKnowledge''s upsert.';
