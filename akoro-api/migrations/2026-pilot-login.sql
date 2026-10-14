-- =============================================================
-- 2026-pilot-login.sql
-- Pilot schools get real logins:
--   * approving (or adding) a pilot school provisions a school_admin
--     account plus a school_profiles row in the new 'pilot' verification
--     stage, and emails the contact a set-password link
--   * pilot_schools keeps the provisioned credential so the admin
--     console's Credentials panel can always show it
-- Idempotent — safe to re-run on every deploy.
-- =============================================================

-- The 'pilot' verification stage: a real school profile that passes the
-- school console's verification gate, recognisable as a pilot partner.
ALTER TABLE public.school_profiles DROP CONSTRAINT IF EXISTS school_profiles_verification_status_check;
ALTER TABLE public.school_profiles ADD CONSTRAINT school_profiles_verification_status_check
  CHECK (verification_status IN ('pending','pilot','verified','rejected'));

-- The provisioned login, kept for the admin Credentials panel.
ALTER TABLE public.pilot_schools ADD COLUMN IF NOT EXISTS login_email          text;
ALTER TABLE public.pilot_schools ADD COLUMN IF NOT EXISTS login_temp_password  text;
ALTER TABLE public.pilot_schools ADD COLUMN IF NOT EXISTS login_provisioned_at timestamptz;

COMMENT ON COLUMN public.pilot_schools.login_email          IS 'The provisioned school-admin login email; NULL until provisioned';
COMMENT ON COLUMN public.pilot_schools.login_temp_password  IS 'The generated starter password — shown in the admin Credentials panel until the school sets their own';
COMMENT ON COLUMN public.pilot_schools.login_provisioned_at IS 'When the login was provisioned';
