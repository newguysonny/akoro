-- =============================================================
-- 2026-task-output-types-2.sql
-- Three task tools were added so teachers can SCHEDULE the work they otherwise
-- do by hand: assign_battle, assign_self_study and run_teaching_tool. The last
-- two emit output_type values the enum doesn't have, and task_outputs.output_type
-- is an enum — an insert with an unknown value fails, and the artifact is lost
-- with only a worker log to show for it (exactly what 2026-task-output-types.sql
-- was written to fix the first time).
--
-- ADD VALUE IF NOT EXISTS is idempotent, and PG12+ permits it inside the
-- migration runner's implicit transaction as long as the new values aren't
-- used in that same transaction — they aren't.
-- =============================================================

ALTER TYPE output_type ADD VALUE IF NOT EXISTS 'self_study';
ALTER TYPE output_type ADD VALUE IF NOT EXISTS 'teaching_tool';

-- Verify:
-- SELECT enum_range(NULL::output_type);
