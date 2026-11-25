-- One-off cleanup for additional disposable documentation test accounts.
-- Narrow prefixes only; these are created exclusively by docs verification.
DELETE FROM public.users
WHERE (email LIKE 'docs-smoke-%@demo.akoro.app'
    OR email LIKE 'docs-2fa-%@demo.akoro.app')
  AND created_at >= '2026-11-25';
