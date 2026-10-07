-- =============================================================
-- 2026-library-folders.sql
-- Library folders — the learner's own organization layer over
-- the Library shelf. Created from the "Add to library" sheet
-- (folder name, cover image, description, visibility).
--
-- visibility 'private' (default) | 'public' — the choice is
--   stored now; public folders get their browsing/sharing
--   surface when the shared-library feature ships. Nothing
--   pretends otherwise: a public folder is not listed anywhere
--   yet, it is simply recorded as the learner chose.
-- cover_key  R2/fallback object key under the owner's own
--   records/<user_id>/ prefix — covers ride the SAME storage
--   pipeline as record files (presigned PUT up, presigned GET
--   down; image-only, 5 MB cap, enforced by the route).
-- name       UNIQUE per learner — no accidental duplicates.
--
-- Items-in-folders (linking records/library items to a folder)
-- is deliberately NOT in this migration: the create flow and
-- the folder strip ship first, organization lands next.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.library_folders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description  TEXT,
  cover_key    TEXT,
  visibility   TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_library_folders_user
  ON edu.library_folders(user_id, created_at DESC);
