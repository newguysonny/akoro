-- =============================================================
-- 2026-study-prep-agent-check.sql — Grand Plan D45 / §7.12
--
-- Study Prep practice is an Agent Check run as a real battle: the teaching
-- guide (the platform) asks, the learner's protégé answers ONLY from what
-- the learner taught it, Sergeant judges, the Education Engine scores. The
-- learner watches it in the battle arena.
--
--   battles.battle_type 'check'   one protégé seat, a mark sheet (no HP, no
--                                 winner, no XP), Sergeant rulings on
--   battles.study_prep_topic_id   which Study Prep topic it checks
--   study_prep_topics.check_*     the topic's current check and its result
-- Idempotent.
-- =============================================================

DO $$
DECLARE
  v_existing text[];
  v_wanted   text[] := ARRAY['check'];
  v_all      text[];
  v_def      text;
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO v_existing
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') AS m
   WHERE c.conrelid = 'public.battles'::regclass AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%battle_type%';
  SELECT array_agg(DISTINCT v ORDER BY v) INTO v_all FROM unnest(COALESCE(v_existing, '{}') || v_wanted) AS v;
  SELECT string_agg(quote_literal(v), ', ') INTO v_def FROM unnest(v_all) AS v;
  ALTER TABLE public.battles DROP CONSTRAINT IF EXISTS battles_battle_type_check;
  EXECUTE format('ALTER TABLE public.battles ADD CONSTRAINT battles_battle_type_check CHECK (battle_type IN (%s))', v_def);
END $$;

ALTER TABLE public.battles
  ADD COLUMN IF NOT EXISTS study_prep_topic_id uuid REFERENCES edu.study_prep_topics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS battles_study_prep_topic_idx ON public.battles (study_prep_topic_id) WHERE study_prep_topic_id IS NOT NULL;

ALTER TABLE edu.study_prep_topics
  ADD COLUMN IF NOT EXISTS check_battle_id uuid,
  ADD COLUMN IF NOT EXISTS check_mode      text,
  ADD COLUMN IF NOT EXISTS check_scored_at timestamptz,
  ADD COLUMN IF NOT EXISTS check_result    jsonb;

COMMENT ON COLUMN public.battles.study_prep_topic_id IS 'An Agent Check (battle_type check): the Study Prep topic it checks (D45).';
COMMENT ON COLUMN edu.study_prep_topics.check_battle_id IS 'The topic''s current Agent Check battle (D45). Scored once: check_scored_at.';
COMMENT ON COLUMN edu.study_prep_topics.check_result IS '{ correct, guessed, wrong, total, score, perQuestion:[{order, outcome, gap?}], gaps }';

-- The scope rule (2026-class-battles.sql) wanted every battle in a course or
-- a classroom. An Agent Check is neither (it belongs to a Study Prep topic),
-- and neither are network battles (createNetworkBattle inserts both null) or
-- the daily battle (recurring_key) — where the rule is live, those inserts
-- failed. A battle is scoped by a course, a classroom, its Study Prep topic,
-- the network creator who made it, or its daily series.
DO $$
BEGIN
  ALTER TABLE public.battles DROP CONSTRAINT IF EXISTS battles_scope_check;
  ALTER TABLE public.battles ADD CONSTRAINT battles_scope_check CHECK (
    course_id IS NOT NULL OR classroom_id IS NOT NULL OR study_prep_topic_id IS NOT NULL
    OR created_by IS NOT NULL OR recurring_key IS NOT NULL
  );
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'battles_scope_check not applied — some rows have no scope at all.';
END $$;
