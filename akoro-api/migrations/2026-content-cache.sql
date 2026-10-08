-- 2026-content-cache.sql — CONTENT-ADDRESSED AI cache for records.
--
-- Extraction (hanji-parse-4b) and transcription (ffmpeg → Deepgram) are
-- expensive, so the cache is keyed by the STORAGE FILE KEY, not by the
-- record or the user:
--   • a learner's own upload lives at records/<userId>/… — user-scoped
--     keys, so private caches can never collide across users;
--   • SHARED files (the discovery feed) have ONE key — parsed once, every
--     later opener (owner or not) reads the same rows for free.
-- The cache therefore inherits the file's visibility from its key.
--
-- content_jobs is the single-flight claim: one row per (content_key,
-- lane); a runner flips/inserts it to 'running' and loses the race if
-- another live claim exists (stale after 10 min — a dead worker's claim
-- is re-claimable). Second-openers see 'running' and poll instead of
-- double-spending, and 'done' means the content is ready for them.

CREATE TABLE IF NOT EXISTS edu.content_parses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_key TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  markdown    TEXT NOT NULL DEFAULT '',
  blocks      JSONB NOT NULL DEFAULT '[]'::jsonb,
  model       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_key, page_number)
);
CREATE INDEX IF NOT EXISTS content_parses_key_idx ON edu.content_parses(content_key);

CREATE TABLE IF NOT EXISTS edu.content_transcripts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_key TEXT NOT NULL,
  user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,  -- who ran the job
  kind        TEXT NOT NULL CHECK (kind IN ('speech', 'visual')),
  start_ms    BIGINT NOT NULL CHECK (start_ms >= 0),
  end_ms      BIGINT,
  speaker     TEXT,
  text        TEXT NOT NULL DEFAULT '',
  model       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_transcripts_key_idx
  ON edu.content_transcripts(content_key, start_ms);

CREATE TABLE IF NOT EXISTS edu.content_jobs (
  content_key TEXT NOT NULL,
  lane        TEXT NOT NULL CHECK (lane IN ('parse', 'av')),
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  started_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  result      JSONB,
  PRIMARY KEY (content_key, lane)
);
