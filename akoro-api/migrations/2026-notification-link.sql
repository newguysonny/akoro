-- =============================================================
-- 2026-notification-link.sql
-- Add an optional in-app deep link to notifications so tapping a bell item can
-- navigate to the relevant page (order, class, review…). Additive + idempotent.
-- =============================================================

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;

NOTIFY pgrst, 'reload schema';
