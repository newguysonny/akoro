-- 2026-battle-entry.sql — a battle's minimum XP to join, set by its creator
-- (battle/entry.js). 0 = open to all. Reviews never have one.
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS min_xp INTEGER NOT NULL DEFAULT 0;
