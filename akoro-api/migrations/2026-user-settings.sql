-- 2026-user-settings.sql
-- Generic per-user settings store (JSONB). Used by the instructor app's
-- streaming-platform connections and available for future key/value settings.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS user_settings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings (user_id);
