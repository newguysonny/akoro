-- =============================================================
-- 2026-learner-location.sql
-- Optional self-reported learner city. Country already exists on public.users.
-- Do not derive time zone from this field: a learner chooses an IANA timezone
-- separately in Settings because countries and cities can have ambiguous zones.
-- Additive + idempotent.
-- =============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS city text;

NOTIFY pgrst, 'reload schema';
