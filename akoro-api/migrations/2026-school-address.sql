-- =============================================================
-- 2026-school-address.sql
-- School onboarding address components. school_profiles already has `country`
-- and a free-text `address`; add the structured sub-fields collected during
-- onboarding. Additive + idempotent.
-- =============================================================

ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS lga   text;   -- Local Government Area
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS city  text;   -- town / city

NOTIFY pgrst, 'reload schema';
