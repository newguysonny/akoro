-- 2026-record-transcripts.sql — audio/video transcripts for library records.
--
-- The reader's transcription pipeline (modules/records/avTranscribeLib.js:
-- ffmpeg 16kHz-mono extraction → Deepgram nova-2, scene frames → captions)
-- stores one row per segment: speech paragraphs carry the speaker label and
-- their natural start/end; visual rows carry a sampled frame's caption with
-- its scene window. One table for both, chronological by start_ms — the
-- reader's transcript list and the session grounding read it in time order
-- (the Fortizo plan's spatial-vs-temporal chunks, adapted). Rows follow the
-- learner and die with their record. Re-transcribing replaces the record's
-- rows (delete-then-insert inside the job).

CREATE TABLE IF NOT EXISTS edu.record_transcripts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  record_id   UUID NOT NULL REFERENCES edu.records(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('speech', 'visual')),
  start_ms    BIGINT NOT NULL CHECK (start_ms >= 0),
  end_ms      BIGINT,
  speaker     TEXT,
  text        TEXT NOT NULL DEFAULT '',
  model       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS record_transcripts_record_idx
  ON edu.record_transcripts(record_id, start_ms);
CREATE INDEX IF NOT EXISTS record_transcripts_user_idx
  ON edu.record_transcripts(user_id, record_id);
