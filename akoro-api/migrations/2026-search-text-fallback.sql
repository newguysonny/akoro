-- =============================================================
-- 2026-search-text-fallback.sql — the curriculum, past-question and syllabus
-- searches answer on TEXT when the query has no vector (2026-10-20).
--
-- These three were vector-only: no query vector (the provider slow, down, or
-- a RunPod worker still starting — lib/searchEmbedding.js gives up after 3 s)
-- meant no results, and during a model switch (every stored vector cleared,
-- lib/embeddingCutover.js) they found nothing at all. Now, like the hybrid
-- searches (records, notes, memories), a NULL p_query_embedding ranks on
-- stemmed full text against p_query_text instead.
--
--   vector given  → exactly as before (cosine, same index use, same columns)
--   vector NULL   → full-text rank; `similarity` is the ts_rank and
--                   `lexical` is true, so callers skip their cosine floor
--
-- plpgsql (not sql) so each branch is its own plan — the vector branch keeps
-- its index — and so public.or_tsquery (2026-hybrid-retrieval.sql) resolves
-- at call time. Re-runnable: drops the old and the new signatures first (the
-- earlier files re-create the old one on every deploy; this file follows them).
-- =============================================================

-- ── Past questions ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS match_past_questions(vector, text, text, integer);
DROP FUNCTION IF EXISTS match_past_questions(vector, text, text, integer, text);
CREATE FUNCTION match_past_questions(
  p_query_embedding vector(1536),
  p_exam            text DEFAULT NULL,
  p_subject         text DEFAULT NULL,
  p_limit           integer DEFAULT 8,
  p_query_text      text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, paper_id uuid, exam_slug text, year integer, number integer,
  stem text, options jsonb, answer text, explanation text,
  subject text, topic text, image_url text, similarity float, lexical boolean
)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
BEGIN
  IF p_query_embedding IS NOT NULL THEN
    RETURN QUERY
    SELECT q.id, q.paper_id, p.exam_slug, p.year, q.number,
           q.stem, q.options, q.answer, q.explanation,
           COALESCE(q.subject, p.subject), q.topic, q.image_url,
           (1 - (q.embedding <=> p_query_embedding))::float, false
    FROM edu.past_questions q
    JOIN edu.past_papers p ON p.id = q.paper_id
    WHERE q.embedding IS NOT NULL
      AND p.status = 'published'
      AND (p_exam    IS NULL OR p.exam_slug = p_exam)
      AND (p_subject IS NULL OR COALESCE(q.subject, p.subject) ILIKE p_subject)
    ORDER BY q.embedding <=> p_query_embedding
    LIMIT p_limit;
  ELSIF public.or_tsquery(p_query_text) IS NOT NULL THEN
    RETURN QUERY
    WITH hits AS (
      SELECT q.id, ts_rank(to_tsvector('english', coalesce(q.stem, '') || ' ' || coalesce(q.topic, '')),
                           public.or_tsquery(p_query_text))::float AS rank
      FROM edu.past_questions q
      JOIN edu.past_papers p ON p.id = q.paper_id
      WHERE p.status = 'published'
        AND (p_exam    IS NULL OR p.exam_slug = p_exam)
        AND (p_subject IS NULL OR COALESCE(q.subject, p.subject) ILIKE p_subject)
        AND to_tsvector('english', coalesce(q.stem, '') || ' ' || coalesce(q.topic, '')) @@ public.or_tsquery(p_query_text)
      ORDER BY rank DESC
      LIMIT p_limit
    )
    SELECT q.id, q.paper_id, p.exam_slug, p.year, q.number,
           q.stem, q.options, q.answer, q.explanation,
           COALESCE(q.subject, p.subject), q.topic, q.image_url, h.rank, true
    FROM hits h
    JOIN edu.past_questions q ON q.id = h.id
    JOIN edu.past_papers p ON p.id = q.paper_id
    ORDER BY h.rank DESC;
  END IF;
END;
$$;

-- ── Curriculum ──────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS match_curriculum(vector, text, text, text, integer);
DROP FUNCTION IF EXISTS match_curriculum(vector, text, text, text, integer, text);
CREATE FUNCTION match_curriculum(
  p_query_embedding vector(1536),
  p_body            text DEFAULT NULL,
  p_subject         text DEFAULT NULL,
  p_class           text DEFAULT NULL,
  p_limit           integer DEFAULT 6,
  p_query_text      text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, curriculum_id uuid, body_slug text, curriculum_title text, subject text,
  theme text, subtheme text, topic text, class_label text,
  performance_objectives text[], content text[], teacher_activities text[],
  student_activities text[], materials text[], evaluation text[],
  detailed boolean, similarity float, lexical boolean
)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
BEGIN
  IF p_query_embedding IS NOT NULL THEN
    RETURN QUERY
    SELECT t.id, c.id, c.body_slug, c.title, COALESCE(c.subject, th.title),
           th.title, st.title, t.title, t.class_label,
           t.performance_objectives, t.content, t.teacher_activities,
           t.student_activities, t.materials, t.evaluation,
           t.detailed,
           (1 - (t.embedding <=> p_query_embedding))::float, false
    FROM edu.curriculum_topics t
    JOIN edu.curricula c            ON c.id = t.curriculum_id
    LEFT JOIN edu.curriculum_subthemes st ON st.id = t.subtheme_id
    LEFT JOIN edu.curriculum_themes th    ON th.id = st.theme_id
    WHERE t.embedding IS NOT NULL
      AND c.status = 'published'
      AND (p_body    IS NULL OR c.body_slug = p_body)
      AND (p_subject IS NULL OR COALESCE(c.subject, th.title) ILIKE p_subject)
      AND (p_class   IS NULL OR t.class_label ILIKE p_class)
    ORDER BY t.embedding <=> p_query_embedding
    LIMIT p_limit;
  ELSIF public.or_tsquery(p_query_text) IS NOT NULL THEN
    RETURN QUERY
    SELECT t.id, c.id, c.body_slug, c.title, COALESCE(c.subject, th.title),
           th.title, st.title, t.title, t.class_label,
           t.performance_objectives, t.content, t.teacher_activities,
           t.student_activities, t.materials, t.evaluation,
           t.detailed,
           ts_rank(x.doc, public.or_tsquery(p_query_text))::float, true
    FROM edu.curriculum_topics t
    JOIN edu.curricula c            ON c.id = t.curriculum_id
    LEFT JOIN edu.curriculum_subthemes st ON st.id = t.subtheme_id
    LEFT JOIN edu.curriculum_themes th    ON th.id = st.theme_id
    CROSS JOIN LATERAL (SELECT to_tsvector('english',
      coalesce(t.title, '') || ' ' || coalesce(th.title, '') || ' ' || coalesce(st.title, '') || ' ' ||
      coalesce(array_to_string(t.performance_objectives, ' '), '') || ' ' || coalesce(array_to_string(t.content, ' '), '')) AS doc) x
    WHERE c.status = 'published'
      AND (p_body    IS NULL OR c.body_slug = p_body)
      AND (p_subject IS NULL OR COALESCE(c.subject, th.title) ILIKE p_subject)
      AND (p_class   IS NULL OR t.class_label ILIKE p_class)
      AND x.doc @@ public.or_tsquery(p_query_text)
    ORDER BY 17 DESC
    LIMIT p_limit;
  END IF;
END;
$$;

-- ── Syllabus ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS match_syllabus(vector, text, integer);
DROP FUNCTION IF EXISTS match_syllabus(vector, text, integer, text);
CREATE FUNCTION match_syllabus(
  p_query_embedding vector(1536),
  p_subject_slug    TEXT DEFAULT NULL,
  p_match_count     INT  DEFAULT 6,
  p_query_text      TEXT DEFAULT NULL
)
RETURNS TABLE (
  id           UUID,
  subject_slug TEXT,
  subject_name TEXT,
  exam         TEXT,
  topic_title  TEXT,
  content      TEXT,
  similarity   FLOAT,
  lexical      BOOLEAN
)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
BEGIN
  IF p_query_embedding IS NOT NULL THEN
    RETURN QUERY
    SELECT c.id, c.subject_slug, s.name, s.exam, c.topic_title, c.content,
           (1 - (c.embedding <=> p_query_embedding))::float, false
    FROM edu.syllabus_chunks c
    JOIN edu.syllabus_subjects s ON s.id = c.subject_id
    WHERE c.embedding IS NOT NULL
      AND (p_subject_slug IS NULL OR c.subject_slug = p_subject_slug)
    ORDER BY c.embedding <=> p_query_embedding
    LIMIT p_match_count;
  ELSIF public.or_tsquery(p_query_text) IS NOT NULL THEN
    RETURN QUERY
    SELECT c.id, c.subject_slug, s.name, s.exam, c.topic_title, c.content,
           ts_rank(to_tsvector('english', coalesce(c.topic_title, '') || ' ' || coalesce(c.content, '')),
                   public.or_tsquery(p_query_text))::float, true
    FROM edu.syllabus_chunks c
    JOIN edu.syllabus_subjects s ON s.id = c.subject_id
    WHERE (p_subject_slug IS NULL OR c.subject_slug = p_subject_slug)
      AND to_tsvector('english', coalesce(c.topic_title, '') || ' ' || coalesce(c.content, '')) @@ public.or_tsquery(p_query_text)
    ORDER BY 7 DESC
    LIMIT p_match_count;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
