-- 2026-agent-network-daily.sql — the daily battle.
--
-- The daily battle is a real battle that recurs: every day at DAILY_BATTLE_HOUR
-- (19:00 Lagos) one battle per subject (split into heats when busy), played in
-- the normal arena. The platform creates it, so it has no creator; it is found
-- by its recurring_key (daily:<day>:<subject>:<heat>). Each learner picks the
-- subject they battle in.
ALTER TABLE edu.agent_network_settings ADD COLUMN IF NOT EXISTS daily_subject TEXT;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS recurring_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_battles_recurring_key ON public.battles (recurring_key) WHERE recurring_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_battles_recurring_key_pattern ON public.battles (recurring_key text_pattern_ops) WHERE recurring_key IS NOT NULL;
ALTER TABLE public.battles ALTER COLUMN created_by DROP NOT NULL;
