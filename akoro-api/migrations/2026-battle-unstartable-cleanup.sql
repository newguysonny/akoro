-- =============================================================
-- 2026-battle-unstartable-cleanup.sql
-- Close the battles that can never start.
--
-- A battle is agent vs agent, so it needs TWO competitors. A teacher hosts
-- rather than competes — they are excluded from the scoreboard and from the
-- player count — so a teacher who picked exactly one learner created a battle
-- with one competitor in it. It could never reach the two it needs.
--
-- Nothing caught that. The invite route allowed it, startBattle would have
-- cancelled it at the start time, and since unscheduled invitations no longer
-- expire there was no start time to reach: the battle sat on "waiting for
-- players to accept" indefinitely, even after that one learner had accepted.
--
-- The route now refuses at creation. This clears the ones already made.
--
-- Cancelled, not deleted: the teacher sees what happened to it, and the
-- learner's acceptance is not silently erased.
--
-- Idempotent: only touches battles still waiting, and only those that cannot
-- reach two players.
-- =============================================================

DO $$
DECLARE
  v_closed int := 0;
  r        record;
BEGIN
  FOR r IN
    SELECT b.id, b.title, b.created_by
    FROM public.battles b
    WHERE b.status IN ('lobby', 'scheduled')
      AND b.scheduled_start IS NULL          -- a scheduled battle still has a start to reach
      -- Everyone invited has answered...
      AND NOT EXISTS (
        SELECT 1 FROM public.battle_participants p
        WHERE p.battle_id = b.id AND p.role = 'participant'
          AND p.joined_at IS NULL AND p.declined_at IS NULL
      )
      -- ...and fewer than two of them are actually playing.
      AND (
        SELECT count(*) FROM public.battle_participants p
        WHERE p.battle_id = b.id AND p.role <> 'teacher'
          AND p.joined_at IS NOT NULL AND p.declined_at IS NULL
      ) < 2
  LOOP
    UPDATE public.battles SET status = 'cancelled' WHERE id = r.id;

    INSERT INTO public.notifications (user_id, type, title, content, related_id)
    VALUES (r.created_by, 'battle_cancelled',
            'Battle cancelled: ' || r.title,
            'This battle could not run — a battle needs two learners competing. Create it again with at least two.',
            r.id);

    v_closed := v_closed + 1;
  END LOOP;

  IF v_closed > 0 THEN
    RAISE NOTICE 'battles: cancelled % unstartable battle(s)', v_closed;
  END IF;
END $$;

-- Verify (should return no rows):
--   SELECT b.id, b.title,
--          (SELECT count(*) FROM battle_participants p
--            WHERE p.battle_id = b.id AND p.role <> 'teacher'
--              AND p.joined_at IS NOT NULL AND p.declined_at IS NULL) AS players
--   FROM battles b
--   WHERE b.status IN ('lobby','scheduled') AND b.scheduled_start IS NULL
--   HAVING (SELECT count(*) FROM battle_participants p
--            WHERE p.battle_id = b.id AND p.role <> 'teacher'
--              AND p.joined_at IS NOT NULL AND p.declined_at IS NULL) < 2;
