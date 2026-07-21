-- =============================================================
-- 2026-syllabus-match-v2.sql
-- Extend match_syllabus() to also return the exam + subject name (via join),
-- so the tutor can show the student a "Aligned to JAMB syllabus: <topic>" chip.
-- Idempotent, re-runs safely on every deploy. The return type changed (added
-- columns), which CREATE OR REPLACE cannot do — so DROP the old function first.
-- =============================================================

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

NOTIFY pgrst, 'reload schema';
