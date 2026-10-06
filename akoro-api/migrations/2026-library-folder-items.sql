-- =============================================================
-- 2026-library-folder-items.sql
-- Folder items — what the "Add to folder" page puts in a folder.
-- Any content in the app can land in a learner's folder: a
-- library record (upload/link/paste), a Pharm.D topic, a course
-- lesson (video), or a library shelf item (course/blog).
--
-- item_type + item_ref identify the source row; the display
-- snapshot (title, sub, kind, link) is stored at ADD time so the
-- folder page renders instantly and never re-queries every
-- surface — and an item keeps its shape even if the source row
-- later changes or its surface gains a new shape.
--   kind   icon hint: pdf | audio | video | image | text | link |
--          paste | blog | course | topic …
--   link   optional in-app deep link (/course/<slug>, /write/blog/
--          <id>) so a folder item can reopen its source; Pharm.D
--          topics live in a modal, not a route, so they carry none.
--
-- UNIQUE (folder_id, item_type, item_ref) — adding the same thing
-- twice is a no-op (the page multi-selects folders, not items).
-- user_id is denormalized from the folder: ownership checks stay
-- single-table, and items die with the folder AND the learner.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.library_folder_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id   UUID NOT NULL REFERENCES edu.library_folders(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  item_type   TEXT NOT NULL CHECK (item_type IN ('record', 'pharmd_topic', 'lesson', 'library')),
  item_ref    TEXT NOT NULL,
  title       TEXT NOT NULL,
  sub         TEXT,
  kind        TEXT,
  link        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (folder_id, item_type, item_ref)
);

CREATE INDEX IF NOT EXISTS idx_library_folder_items_folder
  ON edu.library_folder_items(folder_id, created_at DESC);
