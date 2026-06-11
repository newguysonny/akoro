-- 2026-2fa.sql
-- Two-factor authentication (TOTP) support.
-- two_factor_enabled already added in 2026-instructor-profile.sql; this adds
-- the secret store. Safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false;
