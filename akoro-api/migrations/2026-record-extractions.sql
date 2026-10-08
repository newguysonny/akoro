-- 2026-record-extractions.sql — per-page AI extractions for library records.
--
-- The reader's extraction pipeline (modules/records/extractLib.js → the
-- hanji-parse-4b worker on RunPod) stores one row per parsed page: the
-- reading-order markdown plus the layout blocks (bbox in 0-1000 page
-- space) so the reader can later overlay highlights without re-parsing.
-- Rows follow the learner (user_id cascade) and die with their record
-- (record_id cascade). Re-running a page upserts — extraction is
-- idempotent per (record_id, page_number).

CREATE TABLE IF NOT EXISTS edu.record_extractions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  record_id   UUID NOT NULL REFERENCES edu.records(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  markdown    TEXT NOT NULL DEFAULT '',
  blocks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  model       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (record_id, page_number)
);

CREATE INDEX IF NOT EXISTS record_extractions_user_idx
  ON edu.record_extractions(user_id, record_id);
