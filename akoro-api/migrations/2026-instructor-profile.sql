-- 2026-instructor-profile.sql
-- Adds profile + preference columns used by the instructor (and learner)
-- settings pages. Safe to re-run: every column is guarded with IF NOT EXISTS.

ALTER TABLE users ADD COLUMN IF NOT EXISTS bio                 TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country             TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_name         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_type         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subjects            TEXT[] DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS language            TEXT DEFAULT 'English';
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_mode        TEXT DEFAULT 'system';
ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled  BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs  JSONB DEFAULT '{}'::jsonb;
