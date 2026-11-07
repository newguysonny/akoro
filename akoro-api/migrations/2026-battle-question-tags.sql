-- =============================================================
-- 2026-battle-question-tags.sql — §7.15.1: the question source tags each
-- question with its skill (recall / apply / transfer) and format, so the
-- learner's question signals record the source's tags (tag_source 'question')
-- instead of guessing them from the text. Nullable: older questions keep
-- the derived tags. Idempotent.
-- =============================================================
ALTER TABLE public.battle_questions ADD COLUMN IF NOT EXISTS skill text;
ALTER TABLE public.battle_questions ADD COLUMN IF NOT EXISTS format text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battle_questions_skill_check') THEN
    ALTER TABLE public.battle_questions ADD CONSTRAINT battle_questions_skill_check CHECK (skill IS NULL OR skill IN ('recall', 'apply', 'transfer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'battle_questions_format_check') THEN
    ALTER TABLE public.battle_questions ADD CONSTRAINT battle_questions_format_check CHECK (format IS NULL OR format IN ('mcq', 'short', 'diagram', 'word_problem', 'calculation'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
