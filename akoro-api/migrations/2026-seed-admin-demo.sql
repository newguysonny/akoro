-- =============================================================
-- 2026-seed-admin-demo.sql
-- One SIGN-IN-ABLE test ADMIN for the sandbox (demo group — this file is
-- applied ONLY where VERIFY_TARGET=sandbox, never on production):
--
--   admin@demo.akoro.app  "Demo Admin"  role admin  password Password123!
--
-- Why this exists: tester90 (2026-seed-admin-tester.sql) is a locked,
-- gate-only admin with a discarded password — nobody can sign in as it,
-- so admin-UI/API flows (e.g. Create Account) had no admin to test with
-- on the sandbox. This account fills that gap the same way the 50 demo
-- learners do: an @demo.akoro.app address (which bypasses 2FA and email
-- verification) and the shared demo password.
--
-- Idempotent: created once, keyed by email; an existing row is left
-- untouched (a password changed later in the admin UI is not stomped).
-- =============================================================
DO $$
DECLARE
  v_pw text := '$2b$10$HKzqNJTCBHeB0uWSWhf7PeLIOMrlEw2.9oYDI3vQPEs6WAl5Fo7KS'; -- Password123! (same hash as the demo testers)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE email = 'admin@demo.akoro.app') THEN
    INSERT INTO public.users (email, username, password_hash, full_name, role, is_active, onboarding_completed, email_verified, country)
    VALUES ('admin@demo.akoro.app', 'demo_admin', v_pw, 'Demo Admin', 'admin', true, true, true, 'Nigeria');
  END IF;
END $$;
