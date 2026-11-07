-- =============================================================
-- 2026-peer-help-default-on.sql — "Let my agent help other learners" is ON by
-- default (decided 2026-11-07). A learner who never chose helps others; the
-- moment they choose, help_others_chosen_at records it and their choice stands
-- (a re-run of this file never overrides it — nothing here touches rows).
-- Sensitive struggle types are never shown as stories either way.
-- Idempotent.
-- =============================================================
ALTER TABLE public.user_agents ADD COLUMN IF NOT EXISTS help_others_chosen_at timestamptz;
ALTER TABLE public.user_agents ALTER COLUMN help_others_opt_in SET DEFAULT true;

COMMENT ON COLUMN public.user_agents.help_others_opt_in IS 'Let my agent help other learners: the learner''s choice, read only when help_others_chosen_at is set; unset = on (default since 2026-11-07).';

NOTIFY pgrst, 'reload schema';
