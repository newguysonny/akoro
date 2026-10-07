-- =============================================================
-- 2026-community-activity-types.sql — type + stages for community
-- activities, mirroring the instructor workbench's activity types.
--
-- A community activity now carries its workbench type (assignment,
-- project, multi_stage, self_study, live_course) and — for multi_stage
-- journeys — an ordered stage list [{ kind, title }] (≤ 6), exactly the
-- shape the activities workbench drafts. Existing rows keep working:
-- type defaults to 'assignment', stages to an empty list.
--
-- Idempotent; safe to re-run.
-- =============================================================

ALTER TABLE edu.community_activities
  ADD COLUMN IF NOT EXISTS type   TEXT  NOT NULL DEFAULT 'assignment';
ALTER TABLE edu.community_activities
  ADD COLUMN IF NOT EXISTS stages JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_activities_type_check') THEN
    ALTER TABLE edu.community_activities ADD CONSTRAINT community_activities_type_check
      CHECK (type IN ('assignment', 'project', 'multi_stage', 'self_study', 'live_course'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
