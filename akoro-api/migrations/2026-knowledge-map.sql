-- =============================================================
-- 2026-knowledge-map.sql
--
-- The ORDER of a lesson ladder, and the reasoning behind it.
--
-- lesson_ladders.subtopics is an array of titles. It carries the sequence but
-- says nothing about WHY that sequence — what each step depends on, or what a
-- learner can do after it that they could not before. Without that, nothing can
-- tell a real progression from a table of contents, and the generator produced
-- the latter: "The water cycle" opened on "States of Water: Solid, Liquid and
-- Gas", which is not the beginning. A learner who does not yet know what water
-- IS cannot be taught that it has three states.
--
-- knowledge_map holds one entry per step:
--   { title, kind: foundation|mechanism|application|synthesis,
--     buildsOn: <index of the step it depends on, or null>,
--     whyNow: "what this unlocks" }
--
-- Kept beside subtopics rather than replacing it: every consumer indexes
-- subtopics as strings, and a shape change there would touch the orchestrator,
-- the websocket, self-study and the learner app at once for no gain.
-- =============================================================

ALTER TABLE edu.lesson_ladders ADD COLUMN IF NOT EXISTS knowledge_map JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN edu.lesson_ladders.knowledge_map IS
  'Ordered steps with kind / buildsOn (index) / whyNow. Parallel to subtopics — same order, same length — and empty for teacher-authored schemes of work, where the ordering is the teacher''s own.';

-- Verify:
--   SELECT topic,
--          jsonb_array_length(subtopics)     AS steps,
--          jsonb_array_length(knowledge_map) AS mapped,
--          knowledge_map -> 0 ->> 'title'    AS starts_at,
--          knowledge_map -> 0 ->> 'kind'     AS first_kind
--   FROM edu.lesson_ladders ORDER BY updated_at DESC LIMIT 10;
--
-- A ladder whose first step is not a 'foundation' is worth looking at — that is
-- the shape of the bug this column exists to make visible.
