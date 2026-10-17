-- =============================================================
-- 2026-seed-sandbox-real-account.sql  (demo group: the gate SANDBOX only)
-- A learner that is NOT a test learner by the gate's rule (username isn't
-- testerNN), so the sandbox can exercise phase V4's real-account path end to
-- end without touching a real person. Never in production's schema group.
--   sbxlearner / sbxlearner@sandbox.akoro.invalid  (no usable password)
-- =============================================================
INSERT INTO public.users (email, username, password_hash, full_name, role, is_active, onboarding_completed, email_verified, country)
SELECT 'sbxlearner@sandbox.akoro.invalid', 'sbxlearner', '!', 'Sandbox Learner', 'student', true, true, true, 'Nigeria'
WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE email = 'sbxlearner@sandbox.akoro.invalid');
