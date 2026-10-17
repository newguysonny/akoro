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

-- Its own learning agent (tasks are kept by the agent).
INSERT INTO edu.student_agents (student_id, name)
SELECT id, 'Sandy' FROM public.users WHERE email = 'sbxlearner@sandbox.akoro.invalid'
ON CONFLICT (student_id) DO NOTHING;

-- The app's agent record (tasks.agent_id points here).
INSERT INTO public.user_agents (user_id, agent_name, is_active)
SELECT u.id, 'Sandy', true FROM public.users u
WHERE u.email = 'sbxlearner@sandbox.akoro.invalid'
  AND NOT EXISTS (SELECT 1 FROM public.user_agents a WHERE a.user_id = u.id);
