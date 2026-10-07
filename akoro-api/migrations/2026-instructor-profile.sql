-- 2026-instructor-profile.sql
-- Aligns the instructor app onto the shared profile schema already used by the
-- learner (users.* columns + the user_notification_preferences table).
--
-- Only `bio` is genuinely new; the rest are guarded no-ops on databases where
-- the learner has already created them. Safe to re-run.

ALTER TABLE users ADD COLUMN IF NOT EXISTS bio                 TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country             TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_name         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_type         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subjects            TEXT[] DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS language            TEXT DEFAULT 'English';
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_mode        TEXT DEFAULT 'system';
ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled  BOOLEAN DEFAULT false;

-- Notification preferences live in the shared user_notification_preferences
-- table (created in migration.sql) — no separate column needed here.
