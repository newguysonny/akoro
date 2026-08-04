-- =============================================================
-- 2026-website-ai-sync.sql
-- AI website sync: per-section generated copy, and a name for the public
-- site's AI concierge.
--
-- section_content holds AI-refined copy keyed by template section
-- ('hero', 'about', …). Builder pages already have their own content column;
-- template sections had nowhere to store generated copy.
--
-- ai_chat_name lets the public site's assistant introduce itself with the
-- school's own agent name (from onboarding) rather than a hardcoded one.
-- Idempotent; safe to re-run.
-- =============================================================

ALTER TABLE edu.school_website
  ADD COLUMN IF NOT EXISTS section_content jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE edu.school_website
  ADD COLUMN IF NOT EXISTS ai_chat_name text;

NOTIFY pgrst, 'reload schema';
