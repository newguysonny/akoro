-- =============================================================
-- 2026-records.sql
-- Library records — the learner's own shelf of study material:
-- uploaded files, saved links and pasted text. The shelf was
-- device-local (localStorage details only); records now live on
-- the server so they follow the learner across devices and can
-- actually be OPENED — the file bytes go to Cloudflare R2 (the
-- same store course videos use), the row lives here.
--
-- kind    'upload' | 'link' | 'paste'
--         An 'upload' row with file_key NULL is a legacy record
--         migrated from a device: only its details were ever
--         captured, so the viewer says so honestly instead of
--         pretending the file is there.
-- file_key  R2 object key, always under records/<user_id>/ —
--         the route rejects any other prefix so one learner can
--         never register another's object.
-- url       external link (kind 'link')
-- content   pasted text (kind 'paste'), capped at 20k chars by
--           the route, matching the sheet's counter.
-- progress  self-reported 0–100; 10 is set on first open, 100 on
--           "mark done" — there is no playback to measure.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('upload', 'link', 'paste')),
  name            TEXT NOT NULL,
  mime            TEXT,
  size            BIGINT NOT NULL DEFAULT 0,
  duration        REAL,
  file_key        TEXT,
  url             TEXT,
  content         TEXT,
  progress        INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  last_opened_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_records_user_created
  ON edu.records(user_id, created_at DESC);
