-- =============================================================
-- 2026-edu-blogs.sql — learner-authored blogs (higherEd library)
--
-- higherEd learners write blogs from the Library page's + menu and
-- save them as drafts or publish them. body is the platform's
-- markdown-subset text (the same subset chat renders — no HTML
-- anywhere), so it renders through the shared RichText path.
--
-- Idempotent; safe to re-run.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.blogs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edu_blogs_user
  ON edu.blogs(user_id, status, updated_at DESC);

NOTIFY pgrst, 'reload schema';
