-- 2026-battle-entry.sql — a battle's minimum XP to join, set by its creator
-- (battle/entry.js). 0 = open to all. Reviews never have one.
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS min_xp INTEGER NOT NULL DEFAULT 0;
-- When each question was revealed: a reveal runs once, and no answer counts after it.
ALTER TABLE public.battle_questions ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ;
-- The asker's own "seen" mark for an agent message's answer (the recipient's is read_at).
ALTER TABLE edu.agent_messages ADD COLUMN IF NOT EXISTS answer_read_at TIMESTAMPTZ;
