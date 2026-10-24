-- 2026-guide-review.sql — a review with the teaching guide, requested by the
-- student (reference/Akoro Battles — Model.md, 2026-10-24).
--
-- It runs on the Agent Check machinery (battle_type 'check': the guide asks,
-- the protégé answers from its notes, a mark sheet), outside Study Prep.
-- review_host says who hosts a review ('guide'; a teacher's study review is
-- battle_type 'review'); requested_by is the student who asked (the daily
-- limit counts it); teaching_session_id the session it reviews.
-- Idempotent (schema group).

ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS review_host TEXT;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.battles ADD COLUMN IF NOT EXISTS teaching_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_battles_requested_by ON public.battles(requested_by, created_at DESC) WHERE requested_by IS NOT NULL;
