-- =============================================================
-- 2026-task-output-types.sql
-- The task worker's tools persist their artifacts to task_outputs.output_type,
-- an enum. Seven tools emit values the original enum never included, so those
-- inserts failed and the structured artifacts (explanations, study plans,
-- lesson plans, worksheets, assessments, attendance, interactive decks) were
-- silently lost.
--
-- Add the missing values. ADD VALUE IF NOT EXISTS is idempotent, and PG12+
-- permits it inside the migration runner's implicit transaction because the
-- new values are only added here, never used in the same transaction.
-- =============================================================

ALTER TYPE output_type ADD VALUE IF NOT EXISTS 'explanation';
ALTER TYPE output_type ADD VALUE IF NOT EXISTS 'study_plan';
ALTER TYPE output_type ADD VALUE IF NOT EXISTS 'lesson_plan';
ALTER TYPE output_type ADD VALUE IF NOT EXISTS 'worksheet';
ALTER TYPE output_type ADD VALUE IF NOT EXISTS 'assessment';
ALTER TYPE output_type ADD VALUE IF NOT EXISTS 'attendance';
ALTER TYPE output_type ADD VALUE IF NOT EXISTS 'interactive';

-- Verify:
-- SELECT enum_range(NULL::output_type);
