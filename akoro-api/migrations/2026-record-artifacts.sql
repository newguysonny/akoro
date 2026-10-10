-- =============================================================
-- 2026-record-artifacts.sql
--
-- What a learner makes in the reader, kept: generated study tabs
-- (summary / quiz / flashcards / podcast), notes, annotations and
-- hidden passages ("redactions"). They used to live in component
-- state and vanished when the reader closed.
--
-- One row per item, private per (learner, document). record_id is
-- the document's search record (for a shared file, the owner's —
-- the same target Ask uses), user_id the learner who made it.
--
-- params   the form values it was made with ({ scope, depth, count,
--          difficulty, focus } …)
-- content  the item itself (summaryPoints / quizQuestions / cardSet /
--          notesValue / { text, note } …) plus `ui` progress (quiz
--          answers, card index) — bounded by the API
-- open     whether its tab was open when the reader last closed
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.record_artifacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  record_id    UUID NOT NULL REFERENCES edu.records(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('summary', 'quiz', 'flashcards', 'notes', 'podcast', 'annotation', 'redaction')),
  page_number  INTEGER CHECK (page_number IS NULL OR page_number >= 1),
  params       JSONB NOT NULL DEFAULT '{}'::jsonb,
  content      JSONB NOT NULL DEFAULT '{}'::jsonb,
  open         BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS record_artifacts_owner_idx
  ON edu.record_artifacts(user_id, record_id, created_at);
