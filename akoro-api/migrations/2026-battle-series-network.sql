-- 2026-battle-series-network.sql — recurring battles on the agent network.
--
-- A series can now be a network one: invites to named agents (each
-- occurrence made with everyone already in, battle/networkBattle.js), or an
-- open challenge post re-posted before each start (challenge_requests.series_id).
-- Idempotent (schema group).

ALTER TABLE public.battle_series DROP CONSTRAINT IF EXISTS battle_series_scope_check;
ALTER TABLE public.battle_series ADD CONSTRAINT battle_series_scope_check CHECK (scope IN ('class', 'course', 'network'));

ALTER TABLE edu.challenge_requests ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.battle_series(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_challenge_requests_series ON edu.challenge_requests(series_id, scheduled_for) WHERE series_id IS NOT NULL;

-- A battle draft prepared in the instructor's chat and completed as a
-- recurring battle records the series it became (assignment_id is a battle).
ALTER TABLE public.activity_drafts ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.battle_series(id) ON DELETE SET NULL;
