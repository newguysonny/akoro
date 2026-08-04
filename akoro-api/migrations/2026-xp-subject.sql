-- =============================================================
-- 2026-xp-subject.sql
-- Subject dimension for XP, so students can be ranked per subject.
--
-- Neither xp_transactions nor xp_leaderboard recorded a subject: XP was only
-- ever attributed to a course, a classroom, or globally. Adding it here, plus
-- a best-effort backfill for rows whose subject is still derivable.
--
-- HONEST LIMIT: adaptive-session XP carries no course, so historical adaptive
-- rows cannot be backfilled — only course-linked XP recovers a subject.
-- Subject boards will therefore under-count history and become accurate as
-- new XP accrues.
--
-- Idempotent; safe to re-run.
-- =============================================================

ALTER TABLE xp_transactions ADD COLUMN IF NOT EXISTS subject text;
CREATE INDEX IF NOT EXISTS idx_xp_transactions_subject ON xp_transactions(subject) WHERE subject IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_xp_tx_user_subject      ON xp_transactions(user_id, subject);

-- Backfill what we can: course XP inherits the course's subject.
UPDATE xp_transactions t
   SET subject = c.subject
  FROM courses c
 WHERE t.course_id = c.id
   AND t.subject IS NULL
   AND c.subject IS NOT NULL;

-- Leaderboard gains a subject scope.
--
-- The scope CHECK is rebuilt as the UNION of the scopes we know about and the
-- scopes already present in the table. Listing a fixed set here once dropped
-- 'battle_course' (added by 2026-base-schema step 3b) and halted a deploy:
-- this migration re-runs on every deploy, so it must never invalidate rows a
-- later feature introduced.
ALTER TABLE xp_leaderboard ADD COLUMN IF NOT EXISTS subject text;

DO $$
DECLARE
  v_scopes text[];
  v_extra  text[];
BEGIN
  SELECT array_agg(DISTINCT s ORDER BY s) INTO v_scopes
  FROM (
    SELECT unnest(ARRAY['course', 'classroom', 'global', 'battle_course', 'subject']) AS s
    UNION
    SELECT DISTINCT scope FROM xp_leaderboard WHERE scope IS NOT NULL
  ) t;

  SELECT array_agg(s) INTO v_extra FROM unnest(v_scopes) s
   WHERE s <> ALL (ARRAY['course', 'classroom', 'global', 'battle_course', 'subject']);
  IF v_extra IS NOT NULL THEN
    RAISE NOTICE 'xp_leaderboard has unlisted scopes, preserving them: %', v_extra;
  END IF;

  EXECUTE 'ALTER TABLE xp_leaderboard DROP CONSTRAINT IF EXISTS xp_leaderboard_scope_check';
  EXECUTE format(
    'ALTER TABLE xp_leaderboard ADD CONSTRAINT xp_leaderboard_scope_check CHECK (scope IN (%s))',
    (SELECT string_agg(quote_literal(s), ', ') FROM unnest(v_scopes) s)
  );
END $$;

NOTIFY pgrst, 'reload schema';
