-- =============================================================
-- 2026-battle-invitations.sql
-- A teacher's battle becomes an invitation the learner answers.
--
-- Until now a battle set by a teacher entered every learner automatically:
-- battle_participants rows were written with joined_at already set, so there
-- was nothing to accept and nothing appeared in the learner's Challenges tab.
-- The battle simply happened to them, and if they were not looking at the app
-- at the moment it started, it ran and scored them in their absence.
--
-- joined_at already records "took the seat". What was missing was the other
-- answer — declining. Without it, a learner who said no was indistinguishable
-- from one who had not looked yet, so the start job could not tell whether to
-- keep waiting, and the teacher's participants view could not report it.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.
-- =============================================================

ALTER TABLE public.battle_participants
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

COMMENT ON COLUMN public.battle_participants.declined_at IS
  'Set when the learner declines the invitation. NULL joined_at + NULL declined_at = not answered yet.';

-- Finding "who still owes me an answer" for one battle, and "what am I being
-- asked to join" for one learner, are both this shape.
CREATE INDEX IF NOT EXISTS idx_battle_participants_pending
  ON public.battle_participants (user_id)
  WHERE joined_at IS NULL AND declined_at IS NULL;

-- Verify:
--   SELECT b.title, p.role,
--          count(*) FILTER (WHERE p.joined_at   IS NOT NULL) AS accepted,
--          count(*) FILTER (WHERE p.declined_at IS NOT NULL) AS declined,
--          count(*) FILTER (WHERE p.joined_at IS NULL AND p.declined_at IS NULL) AS pending
--   FROM public.battle_participants p
--   JOIN public.battles b ON b.id = p.battle_id
--   GROUP BY b.title, p.role;
