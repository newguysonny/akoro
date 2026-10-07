-- =============================================================
-- 2026-seed-agent-covers.sql
-- Gives every marketplace agent listing a cover/banner image so the
-- Discovery "Teaching Guides" cards and the agent profile page show
-- artwork instead of just the avatar gradient.
--
-- Stable placeholder per listing (picsum seed by id), loaded directly by
-- the learner's browser. Only fills blanks, so a teacher's real upload is
-- never overwritten and re-runs are idempotent.
-- =============================================================

UPDATE edu.marketplace_listings
SET cover_image_url = 'https://picsum.photos/seed/agent-' || id::text || '/600/360'
WHERE cover_image_url IS NULL OR cover_image_url = '';

-- Verify:
-- SELECT title, teacher_name, cover_image_url FROM edu.marketplace_listings ORDER BY title;
