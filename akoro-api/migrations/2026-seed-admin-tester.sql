-- =============================================================
-- 2026-seed-admin-tester.sql
-- One test ADMIN for the Verification Gate (tester90), so the gate can run
-- the model evals (/api/admin/evals) the way the admin Evals page does —
-- the Phase 17 baselines (DeepSeek now, Qwen3-4B later).
--
--   tester90  "Eval Tester"  tester90@demo.akoro.app  role admin
--
-- NO usable password: the hash is of a random secret that was thrown away,
-- so nobody can sign in as this account (this seed runs on production too).
-- Only the gate acts as it, with its own short-lived internal token, and the
-- gate lets it reach /api/admin/evals and nothing else (verify/context.js).
-- Idempotent: created once, keyed by email; the hash and role are re-asserted.
-- =============================================================
DO $$
DECLARE
  v_locked text := '$2b$10$tYWUEY91NVjszvREtN2JOOi.jjj5p5fFAlsyAA0PteAUpTWicYtj6'; -- random, discarded
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE email = 'tester90@demo.akoro.app') THEN
    INSERT INTO public.users (email, username, password_hash, full_name, role, is_active, onboarding_completed, email_verified, country)
    VALUES ('tester90@demo.akoro.app', 'tester90', v_locked, 'Eval Tester', 'admin', true, true, true, 'Nigeria');
  ELSE
    UPDATE public.users SET password_hash = v_locked, role = 'admin'
    WHERE email = 'tester90@demo.akoro.app';
  END IF;
END $$;
