-- Content hub: an optional media attachment (image/video) per creation, used
-- when posting to channels (required for Instagram/TikTok). Idempotent.
ALTER TABLE edu.content_creations ADD COLUMN IF NOT EXISTS media_url  text;
ALTER TABLE edu.content_creations ADD COLUMN IF NOT EXISTS media_type text;  -- 'image' | 'video'
