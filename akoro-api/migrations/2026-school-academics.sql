-- =============================================================
-- 2026-school-academics.sql
-- School academic profile collected at onboarding: education levels offered,
-- ownership type and curriculum. Additive + idempotent.
-- =============================================================

ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS education_levels jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS ownership_type text;   -- Private | Public | Faith-based | Community
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS curriculum text;       -- Nigerian | British | Montessori | American | IB | Mixed

NOTIFY pgrst, 'reload schema';
