-- =============================================================
-- 2026-school-details.sql
-- More school profile details: year established, gender composition, boarding
-- status and approximate student population (size band — feeds plan sizing).
-- Additive + idempotent.
-- =============================================================

ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS year_established int;
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS gender_type   text;   -- Mixed | Boys only | Girls only
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS boarding_type text;   -- Day only | Boarding only | Day & Boarding
ALTER TABLE public.school_profiles ADD COLUMN IF NOT EXISTS student_band  text;   -- 1–100 | 101–300 | ...

NOTIFY pgrst, 'reload schema';
