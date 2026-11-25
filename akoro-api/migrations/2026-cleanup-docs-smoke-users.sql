-- One-off cleanup for disposable documentation smoke accounts.
-- These accounts are created only by docs verification scripts and must never
-- survive a run. Keeping the pattern narrow avoids touching real demo users.
DELETE FROM public.users
WHERE email LIKE 'docs-smoke-%@demo.akoro.app'
  AND created_at >= '2026-11-25';
