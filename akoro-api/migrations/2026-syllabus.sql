-- =============================================================
-- 2026-syllabus.sql
-- Exam-syllabus knowledge base (WASSCE / WAEC first) that agents ground their
-- teaching in. Two layers:
--   • structured  — subjects → topics → subtopics/objectives (precise lookup)
--   • vector      — one embedded chunk per subtopic for semantic RAG retrieval
-- Mirrors the existing edu.* RAG tables (pgvector 1536 / ivfflat cosine).
-- Additive + idempotent.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.syllabus_subjects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam            TEXT NOT NULL DEFAULT 'WASSCE',   -- WASSCE | JAMB | …
  name            TEXT NOT NULL,                    -- "Physics"
  slug            TEXT NOT NULL,                    -- "physics"
  code            TEXT,                             -- WAEC subject code
  aims            TEXT,                             -- syllabus aims/preamble
  paper_structure JSONB,                            -- papers, duration, weighting
  source          TEXT,                             -- where the content came from
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exam, slug)
);

CREATE TABLE IF NOT EXISTS edu.syllabus_topics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  UUID NOT NULL REFERENCES edu.syllabus_subjects(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_syllabus_topics_subject ON edu.syllabus_topics(subject_id, sort_order);

CREATE TABLE IF NOT EXISTS edu.syllabus_subtopics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id    UUID NOT NULL REFERENCES edu.syllabus_topics(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  content     TEXT,                        -- notes / what students should know
  objectives  TEXT[],                      -- specific learning objectives
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_syllabus_subtopics_topic ON edu.syllabus_subtopics(topic_id, sort_order);

-- One embedded chunk per subtopic (denormalised subject/topic for cheap filters).
CREATE TABLE IF NOT EXISTS edu.syllabus_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   UUID NOT NULL REFERENCES edu.syllabus_subjects(id) ON DELETE CASCADE,
  subject_slug TEXT NOT NULL,
  topic_title  TEXT,
  subtopic_id  UUID REFERENCES edu.syllabus_subtopics(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  embedding    vector(1536),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_syllabus_chunks_subject ON edu.syllabus_chunks(subject_slug);
CREATE INDEX IF NOT EXISTS idx_syllabus_chunks_embedding
  ON edu.syllabus_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Semantic match, optionally scoped to one subject (p_subject_slug = NULL = all).
-- Returns exam + subject name (join) for the tutor's "Aligned to JAMB" chips.
-- DROP first: schema migrations re-run every deploy, and a return-type change
-- can't be done via CREATE OR REPLACE — so drop then create for re-runnability.
DROP FUNCTION IF EXISTS match_syllabus(vector, text, integer);
CREATE OR REPLACE FUNCTION match_syllabus(
  p_query_embedding vector(1536),
  p_subject_slug    TEXT DEFAULT NULL,
  p_match_count     INT  DEFAULT 6
)
RETURNS TABLE (
  id           UUID,
  subject_slug TEXT,
  subject_name TEXT,
  exam         TEXT,
  topic_title  TEXT,
  content      TEXT,
  similarity   FLOAT
)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.subject_slug, s.name AS subject_name, s.exam, c.topic_title, c.content,
         1 - (c.embedding <=> p_query_embedding) AS similarity
  FROM edu.syllabus_chunks c
  JOIN edu.syllabus_subjects s ON s.id = c.subject_id
  WHERE c.embedding IS NOT NULL
    AND (p_subject_slug IS NULL OR c.subject_slug = p_subject_slug)
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
$$;

GRANT ALL ON edu.syllabus_subjects, edu.syllabus_topics, edu.syllabus_subtopics, edu.syllabus_chunks TO service_role;
NOTIFY pgrst, 'reload schema';
