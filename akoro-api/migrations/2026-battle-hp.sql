-- 2026-battle-hp.sql — HP lost per miss, set by each battle's creator
-- (battle/hp.js). Shown to invitees before they accept. 0 = no knockouts.
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS hp_per_miss INTEGER NOT NULL DEFAULT 10;
ALTER TABLE public.battles DROP CONSTRAINT IF EXISTS battles_hp_per_miss_check;
ALTER TABLE public.battles ADD CONSTRAINT battles_hp_per_miss_check CHECK (hp_per_miss BETWEEN 0 AND 50);
ALTER TABLE edu.challenge_requests ADD COLUMN IF NOT EXISTS hp_per_miss INTEGER NOT NULL DEFAULT 10;
