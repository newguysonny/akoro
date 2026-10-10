-- 2026-battle-judge.sql — Sergeant judges battles.
-- explanation: Sergeant's one-line reason for each question's answer (shown at the reveal).
-- judge_verdict: Sergeant's verdict once the battle is over.
ALTER TABLE public.battle_questions ADD COLUMN IF NOT EXISTS explanation TEXT;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS judge_verdict TEXT;
