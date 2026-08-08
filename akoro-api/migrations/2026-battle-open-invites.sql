-- =============================================================
-- 2026-battle-open-invites.sql
-- An invitation with no deadline.
--
-- Every battle was given expires_at = now() + 60 minutes, from a default
-- parameter no form ever exposed. An hour is a sensible window for a learner
-- challenging a classmate who is online right now. It is the wrong rule for a
-- teacher: a battle set at 08:00 for a 14:00 lesson had its invitations expire
-- at 09:00, and every learner who had not opened the app by then lost it
-- silently — the card simply stopped being returned by /my-challenges.
--
-- The deadline for accepting a SCHEDULED battle is the moment it starts; there
-- is nothing to accept after that. A battle with no schedule has no natural
-- deadline at all, so it gets none — the invitation waits until it is answered.
--
-- That needs expires_at to be nullable. NULL now means "no deadline", which is
-- why every read of it has to be null-safe: `new Date(null)` is the epoch, so a
-- naive comparison would treat an open invitation as expired in 1970.
--
-- Idempotent: DROP NOT NULL is a no-op if it is already dropped.
-- =============================================================

ALTER TABLE public.battles ALTER COLUMN expires_at DROP NOT NULL;

COMMENT ON COLUMN public.battles.expires_at IS
  'Deadline for accepting the invitation. NULL = no deadline (unscheduled battles). For a scheduled battle this is its start time.';

-- Existing unstarted, unscheduled battles are carrying an arbitrary hour-long
-- deadline nobody chose. Clear it so they behave like the ones created from
-- now on, rather than quietly expiring under learners who can still see them.
UPDATE public.battles
   SET expires_at = NULL
 WHERE status IN ('lobby', 'scheduled')
   AND scheduled_start IS NULL
   AND expires_at IS NOT NULL;

-- A scheduled battle's deadline is its start. Where the two disagree, the
-- start time is the one that means something.
UPDATE public.battles
   SET expires_at = scheduled_start
 WHERE status IN ('lobby', 'scheduled')
   AND scheduled_start IS NOT NULL
   AND (expires_at IS NULL OR expires_at <> scheduled_start);

-- Verify:
--   SELECT status, scheduled_start IS NULL AS unscheduled,
--          count(*) FILTER (WHERE expires_at IS NULL) AS no_deadline,
--          count(*) FILTER (WHERE expires_at IS NOT NULL) AS has_deadline
--   FROM public.battles GROUP BY 1, 2 ORDER BY 1, 2;
