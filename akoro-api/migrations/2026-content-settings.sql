-- Content hub: per-school content preferences (brand voice, default hashtags,
-- auto-publish, etc.) used by the Blog / Social / Activities generators.
-- Idempotent; runs on every deploy.
ALTER TABLE edu.school_portal_settings
  ADD COLUMN IF NOT EXISTS content jsonb NOT NULL DEFAULT '{}'::jsonb;
