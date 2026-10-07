-- =============================================================
-- 2026-site-ai-chat.sql
-- "Sync AI Bot" toggle for the public school website: when on, a floating
-- AI-chat widget is injected on every page and an "AI Chat" page is added
-- to the site. Additive + idempotent.
-- =============================================================

ALTER TABLE edu.school_website ADD COLUMN IF NOT EXISTS ai_chat_enabled boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
