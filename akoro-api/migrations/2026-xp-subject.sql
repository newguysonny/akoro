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
ALTER TABLE xp_leaderboard ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE xp_leaderboard DROP CONSTRAINT IF EXISTS xp_leaderboard_scope_check;
ALTER TABLE xp_leaderboard ADD  CONSTRAINT xp_leaderboard_scope_check
  CHECK (scope IN ('course', 'classroom', 'global', 'subject'));

NOTIFY pgrst, 'reload schema';
