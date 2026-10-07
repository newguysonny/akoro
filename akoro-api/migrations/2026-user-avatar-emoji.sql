-- =============================================================
-- 2026-user-avatar-emoji.sql
-- Learners can pick an emoji avatar (settings → profile), but there was no
-- column to store it — the PATCH silently dropped it and it reverted to the
-- default on reload. Add the column so the choice persists.
-- Idempotent.
-- =============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS avatar_emoji TEXT;
