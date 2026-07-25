-- Content hub: track whether a generated creation has been posted, and where.
-- Idempotent; runs every deploy.
ALTER TABLE edu.content_creations ADD COLUMN IF NOT EXISTS posted_at       timestamptz;
ALTER TABLE edu.content_creations ADD COLUMN IF NOT EXISTS posted_channels text[] NOT NULL DEFAULT '{}';
