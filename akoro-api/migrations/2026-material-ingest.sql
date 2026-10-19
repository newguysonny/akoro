-- =============================================================
-- 2026-material-ingest.sql — Grand Plan §7.17 / D51–D54
-- A file the learner drops into Agent Chat is saved to their Library in a
-- folder the protégé picks or creates (D51). One row per upload batch: the
-- `material_ingest` workflow's state, what it created (so Undo removes
-- exactly that), and the chat message that shows its card.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.material_ingests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  chat_session_id  uuid,
  chat_message_id  uuid,
  state            text NOT NULL DEFAULT 'received'
                   CHECK (state IN ('received', 'filed', 'extracting', 'structured', 'offering_more', 'ready', 'failed', 'undone')),
  names            text[] NOT NULL DEFAULT '{}',
  record_ids       uuid[] NOT NULL DEFAULT '{}',
  folder_id        uuid REFERENCES edu.library_folders(id) ON DELETE SET NULL,
  folder_name      text,
  folder_created   boolean NOT NULL DEFAULT false,   -- Undo removes the folder only if this ingest made it
  doc_kind         text,                             -- past_paper | notes | textbook | syllabus | slides | other
  subject          text,
  pages            integer,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_material_ingests_user ON edu.material_ingests(user_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
