-- =============================================================
-- 2026-agent-tools-areas.sql — one taxonomy for built tools (2026-11-14).
--
-- area             the tool's PRIMARY area, derived at build time from its
--                  main read (self-tooling/areas.js) — grouping and runtime
--                  selection key on it. NULL on rows built before this
--                  migration: readers derive it on the fly from `views`.
-- secondary_areas  every other area the tool touches (earlier reads, the
--                  area of anything it writes) — metadata, never a second
--                  listing.
-- tags             the learner's own free-form grouping (Settings → My
--                  tools), never part of the shared taxonomy.
-- Idempotent.
-- =============================================================
ALTER TABLE edu.agent_tools ADD COLUMN IF NOT EXISTS area text;
ALTER TABLE edu.agent_tools ADD COLUMN IF NOT EXISTS secondary_areas jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE edu.agent_tools ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
