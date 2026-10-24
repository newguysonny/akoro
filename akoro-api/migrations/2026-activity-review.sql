-- 2026-activity-review.sql — an assignment or self study comes with a review
-- battle (reference/Akoro Activity + Review — Plan.md). Each learner's
-- protégé is reviewed on the activity's topic, concepts and objectives at the
-- time the instructor set (self-study/activityReview.js); a learner who hasn't
-- submitted by then is reviewed at the due date. Not graded.
--   self_study_assignments.details.review = { on, at, questions }
--   self_study_targets.review_battle_id   the learner's review (once each)
--   battles.activity_assignment_id        the activity a review belongs to
-- Idempotent (schema group).

ALTER TABLE edu.self_study_targets ADD COLUMN IF NOT EXISTS review_battle_id UUID;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS activity_assignment_id UUID;
CREATE INDEX IF NOT EXISTS idx_battles_activity_assignment ON public.battles(activity_assignment_id) WHERE activity_assignment_id IS NOT NULL;
