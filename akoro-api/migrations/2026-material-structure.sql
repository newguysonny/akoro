-- =============================================================
-- 2026-material-structure.sql — Grand Plan §7.17.2 "structured" (D53)
-- What reading an upload found: its topics (with the pages they are on) and,
-- for a past paper, its questions — the material Study Prep plans from and
-- weights by (§7.17.3). Past-paper questions belong to the learner who
-- uploaded them and are never shown to anyone else.
-- =============================================================

ALTER TABLE edu.material_ingests ADD COLUMN IF NOT EXISTS structure jsonb;

-- A chat upload is private to its owner (D51/D53, "Only you can see this"):
-- the Discover feed and shared-file access never show a private record.
ALTER TABLE edu.records ADD COLUMN IF NOT EXISTS private boolean NOT NULL DEFAULT false;     -- { title, summary, topics: [{ name, pages, weight }] }

CREATE TABLE IF NOT EXISTS edu.material_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ingest_id   uuid NOT NULL REFERENCES edu.material_ingests(id) ON DELETE CASCADE,
  record_id   uuid REFERENCES edu.records(id) ON DELETE CASCADE,
  exam        text,
  subject     text,
  year        integer CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
  number      text,
  marks       integer CHECK (marks IS NULL OR marks BETWEEN 0 AND 200),
  topic       text NOT NULL,
  page        integer,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_material_questions_user_topic ON edu.material_questions(user_id, subject, topic);
CREATE INDEX IF NOT EXISTS idx_material_questions_ingest ON edu.material_questions(ingest_id);

NOTIFY pgrst, 'reload schema';
