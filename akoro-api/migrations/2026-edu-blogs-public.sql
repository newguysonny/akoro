-- =============================================================
-- 2026-edu-blogs-public.sql — learner blogs on the public blog
--
-- When a learner publishes, the post is mirrored into
-- content.blog_posts under the "Community" category (the landing
-- homepage carousel and the /blog page already render that table).
-- public_slug remembers the mirrored row so edits, unpublishes and
-- deletes keep the two in sync.
--
-- Idempotent; safe to re-run.
-- =============================================================

ALTER TABLE edu.blogs
  ADD COLUMN IF NOT EXISTS public_slug TEXT;

NOTIFY pgrst, 'reload schema';
