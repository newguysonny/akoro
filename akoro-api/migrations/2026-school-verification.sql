-- =============================================================
-- 2026-school-verification.sql
-- Admin approval for schools that sign up. A newly self-registered school is
-- inserted with verification_status='pending' (see profiles.create); an akoro
-- admin verifies or rejects it from the admin Schools page. Mirrors instructor
-- verification and the ownership-links pattern. Additive + idempotent.
--
-- The column DEFAULTS to 'verified' so that (a) rows that already existed before
-- this gate stay usable, and (b) re-running this migration every deploy is a
-- no-op (ADD COLUMN IF NOT EXISTS does nothing once the column exists — there is
-- no blanket UPDATE that could clobber a genuinely pending school).
-- =============================================================

ALTER TABLE public.school_profiles
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'verified';

ALTER TABLE public.school_profiles
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE public.school_profiles DROP CONSTRAINT IF EXISTS school_profiles_verification_status_check;
ALTER TABLE public.school_profiles ADD CONSTRAINT school_profiles_verification_status_check
  CHECK (verification_status IN ('pending','verified','rejected'));

CREATE INDEX IF NOT EXISTS idx_school_profiles_verification
  ON public.school_profiles (verification_status);

NOTIFY pgrst, 'reload schema';
