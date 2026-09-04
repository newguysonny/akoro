-- =============================================================
-- 2026-battle-study-review.sql
-- A battle with one learner in it and no winner: a study review.
--
-- Every battle so far has been a contest — two or more agents, HP, a ranking,
-- an XP pool split by placing. A teacher who wants to check what ONE learner
-- has retained has no way to use any of it: the invite routes refuse a single
-- learner (correctly — there is nobody to compete against), and the engine ends
-- a battle as soon as one player is left standing.
--
-- 'review' is the same machinery pointed at a different question. The learner
-- works through the questions exactly as in a battle; what comes out is a mark
-- sheet — every question, what they chose, what was right — rather than a
-- winner. Nobody is ranked, nobody wins, and the XP pool is not divided.
--
-- The CHECK is rebuilt from the UNION of what is already allowed and what we
-- are adding, so it can never narrow an existing deployment. Reading the live
-- constraint rather than assuming ('1v1','open','classroom') matters: this file
-- re-runs on every deploy, and a value some other migration added must survive.
-- =============================================================

DO $$
DECLARE
  v_existing text[];
  v_wanted   text[] := ARRAY['1v1', 'open', 'classroom', 'review'];
  v_all      text[];
  v_def      text;
BEGIN
  -- Pull the values the live CHECK already permits.
  SELECT array_agg(DISTINCT m[1])
    INTO v_existing
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''', 'g') AS m
   WHERE c.conrelid = 'public.battles'::regclass
     AND c.contype  = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%battle_type%';

  SELECT array_agg(DISTINCT v ORDER BY v)
    INTO v_all
    FROM unnest(COALESCE(v_existing, '{}') || v_wanted) AS v;

  SELECT string_agg(quote_literal(v), ', ') INTO v_def FROM unnest(v_all) AS v;

  ALTER TABLE public.battles DROP CONSTRAINT IF EXISTS battles_battle_type_check;
  EXECUTE format(
    'ALTER TABLE public.battles ADD CONSTRAINT battles_battle_type_check CHECK (battle_type IN (%s))',
    v_def);

  RAISE NOTICE 'battles.battle_type now allows: %', v_def;
END $$;

COMMENT ON COLUMN public.battles.battle_type IS
  '1v1 | open | classroom | review. A review has one learner and produces a mark sheet, not a winner.';

-- Verify:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.battles'::regclass AND conname = 'battles_battle_type_check';
