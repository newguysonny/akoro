-- =============================================================
-- 2026-hybrid-retrieval.sql
--
-- Metadata filtering and hybrid (keyword + vector) search on the three
-- PERSONAL knowledge stores.
--
-- Before this, match_student_knowledge / match_agent_knowledge /
-- match_training_chunks took an owner id and a top-k and nothing else. Two
-- consequences, both real:
--
--   · No subject filter. A Mathematics question could retrieve a Social
--     Studies note purely because the vectors happened to sit close, and the
--     only thing stopping it being used was a similarity floor in JS.
--
--   · Vector only. Embeddings are weak on exactly what school notes are full
--     of — a formula, a definition, a named person, a unit. "P x R x T / 100"
--     and "simple interest formula" are near-unrelated as vectors and the same
--     thing to a learner.
--
-- So each of the three now takes an optional subject and an optional query
-- TEXT alongside the vector, and fuses two rankings.
--
-- FUSION: Reciprocal Rank Fusion, score = Σ 1/(k + rank), k = 60.
--
-- Chosen over a weighted score of similarity + ts_rank because those two
-- numbers are not comparable: cosine similarity on this data lives in a narrow
-- band around 0.3–0.8, ts_rank is unbounded and depends on document length, and
-- any weighting between them is a constant someone picked once and nobody can
-- ever tune. RRF only uses the ORDER each arm produced, so it needs no
-- calibration and cannot be broken by one arm changing scale. k = 60 is the
-- value from the original paper and is deliberately not exposed: it flattens
-- the difference between rank 1 and rank 2 so a single arm cannot dominate.
--
-- A row found by only one arm still scores — it simply gets one term instead of
-- two, which is the behaviour you want. A note that is the top lexical hit and
-- invisible to the vector search still surfaces.
-- =============================================================

-- ── Query lexing ─────────────────────────────────────────────────────────────
-- websearch_to_tsquery ANDs its terms, which is right for a search box and
-- wrong here: the query is a whole exam question, and requiring a note to
-- contain every word of it means the lexical arm matches nothing, ever. (It
-- did. The first version of this migration retrieved zero lexical hits for
-- "simple interest formula principal rate time" against a note that said
-- "Simple interest = P x R x T / 100", because the note lacks the word
-- "formula".)
--
-- So the query is lexed the same way the document is — stemming, stopwords —
-- and the surviving lexemes are ORed. ts_rank then does the actual work of
-- ranking by how many matched and how significant they are.
CREATE OR REPLACE FUNCTION public.or_tsquery(p_text text)
RETURNS tsquery LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE
    WHEN p_text IS NULL OR length(btrim(p_text)) = 0 THEN NULL
    ELSE (SELECT string_agg(lexeme, ' | ') FROM unnest(to_tsvector('english', p_text)))::tsquery
  END;
$function$;

-- ── Subject matching ─────────────────────────────────────────────────────────
-- Subject is free text: teachers type it, models generate it, and seeds carry
-- their own spellings. "Maths" / "Mathematics", "Science" / "Basic Science",
-- "English" / "English Language" all occur and all mean one thing, and none of
-- them is a substring of its sibling — a plain ILIKE '%x%' matches none of
-- those pairs. (It didn't. The first version of this claimed to tolerate them
-- and quietly filtered every one out.)
--
-- Trigram similarity does separate them from genuinely different subjects:
-- Maths/Mathematics scores 0.31 and Science/Basic Science 0.57, while
-- Mathematics/Social Studies scores 0. The 0.3 threshold sits in that gap.
--
-- A NULL subject on the row always passes: a note nobody labelled should not be
-- invisible, and most of the older rows have none.
CREATE OR REPLACE FUNCTION public.subject_matches(p_row_subject text, p_wanted text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $function$
  SELECT p_wanted IS NULL
      OR p_row_subject IS NULL
      OR p_row_subject ILIKE '%' || p_wanted || '%'
      OR p_wanted ILIKE '%' || p_row_subject || '%'
      OR similarity(p_row_subject, p_wanted) >= 0.3;
$function$;

-- ── Lexical indexes ──────────────────────────────────────────────────────────
-- GIN over the same text the vector was built from. Without these the lexical
-- arm is a sequential scan of every note the learner owns, on every question of
-- every battle.
CREATE INDEX IF NOT EXISTS idx_student_knowledge_fts
  ON edu.student_knowledge USING gin (to_tsvector('english', coalesce(topic, '') || ' ' || coalesce(content, '')));
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_fts
  ON edu.agent_knowledge   USING gin (to_tsvector('english', coalesce(topic, '') || ' ' || coalesce(content, '')));
CREATE INDEX IF NOT EXISTS idx_training_chunks_fts
  ON edu.training_chunks   USING gin (to_tsvector('english', coalesce(chunk_text, '')));

-- Subject filters are now in the WHERE clause of every personal search.
CREATE INDEX IF NOT EXISTS idx_student_knowledge_subject ON edu.student_knowledge (student_id, subject);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_subject   ON edu.agent_knowledge (agent_id, subject);

-- ── Freshness ────────────────────────────────────────────────────────────────
-- When the embedding was built, so a row whose CONTENT has since changed can be
-- found and re-embedded. Without this a note could be edited and its vector
-- would keep pointing at the old wording forever, with nothing able to detect
-- it — the stalest kind of stale, because everything still works.
ALTER TABLE edu.student_knowledge ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;
ALTER TABLE edu.agent_knowledge   ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;
ALTER TABLE edu.training_chunks   ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;
ALTER TABLE edu.syllabus_chunks   ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;
ALTER TABLE edu.curriculum_topics ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;
ALTER TABLE edu.past_questions    ADD COLUMN IF NOT EXISTS embedded_at TIMESTAMPTZ;

-- Existing rows with a vector were embedded at some point in the past; stamping
-- them with their own updated_at marks them current rather than sending the
-- whole corpus back through the embedding API on first boot.
UPDATE edu.student_knowledge SET embedded_at = COALESCE(updated_at, created_at)
  WHERE embedding IS NOT NULL AND embedded_at IS NULL;
UPDATE edu.agent_knowledge   SET embedded_at = COALESCE(updated_at, created_at)
  WHERE embedding IS NOT NULL AND embedded_at IS NULL;
UPDATE edu.training_chunks   SET embedded_at = created_at
  WHERE embedding IS NOT NULL AND embedded_at IS NULL;

-- Partial indexes for the sweeper: it asks "what is missing or stale", and that
-- question should never scan the whole corpus.
CREATE INDEX IF NOT EXISTS idx_student_knowledge_needs_embed
  ON edu.student_knowledge (updated_at) WHERE embedding IS NULL OR embedded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_needs_embed
  ON edu.agent_knowledge (updated_at) WHERE embedding IS NULL OR embedded_at IS NULL;

-- ── The three personal searches ──────────────────────────────────────────────
-- Dropped rather than replaced: the signatures gain parameters, and a
-- CREATE OR REPLACE would leave the old arity behind as an overload for
-- PostgREST to pick between.

-- ── Clear every overload before recreating ───────────────────────────────────
-- Dropping by explicit signature is not enough. It requires knowing every
-- arity that has ever existed, and production carried one this file did not
-- name — so the old function survived, CREATE added a second, and the
-- unqualified COMMENT below then failed with
--
--     function name "public.match_student_knowledge" is not unique
--
-- halting the deploy. A migration cannot assume it knows the shape of the
-- database it is arriving at; it can only assert the shape it leaves behind.
DO $drop$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('match_student_knowledge', 'match_agent_knowledge', 'match_training_chunks')
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END $drop$;

CREATE FUNCTION public.match_student_knowledge(
  p_student_id      uuid,
  p_query_embedding vector,
  p_match_count     integer DEFAULT 6,
  p_query_text      text    DEFAULT NULL,
  p_subject         text    DEFAULT NULL,
  p_exclude_tags    text[]  DEFAULT NULL
)
RETURNS TABLE(id uuid, topic text, content text, source text, subject text,
              confidence numeric, similarity double precision,
              lexical_rank integer, vector_rank integer, fused double precision)
LANGUAGE sql STABLE AS $function$
  WITH filtered AS (
    SELECT k.id, k.topic, k.content, k.source, k.subject, k.confidence, k.embedding
    FROM edu.student_knowledge k
    WHERE k.student_id = p_student_id
      -- Subject is matched loosely on purpose: it is free text typed by
      -- teachers and generated by models, so "Maths", "Mathematics" and
      -- "mathematics" all occur and all mean one thing.
      AND public.subject_matches(k.subject, p_subject)
      -- Battle-encounter placeholders record that a learner MET a topic. They
      -- are not knowledge about it, and the lexical arm would happily surface
      -- one because it repeats the topic name.
      AND (p_exclude_tags IS NULL OR NOT (k.tags && p_exclude_tags))
  ),
  vec AS (
    SELECT f.id, 1 - (f.embedding <=> p_query_embedding) AS similarity,
           row_number() OVER (ORDER BY f.embedding <=> p_query_embedding) AS rank
    FROM filtered f
    WHERE p_query_embedding IS NOT NULL AND f.embedding IS NOT NULL
    LIMIT GREATEST(p_match_count * 3, 12)
  ),
  lex AS (
    SELECT f.id,
           row_number() OVER (
             ORDER BY ts_rank(to_tsvector('english', coalesce(f.topic,'') || ' ' || coalesce(f.content,'')),
                              public.or_tsquery(p_query_text)) DESC) AS rank
    FROM filtered f
    WHERE public.or_tsquery(p_query_text) IS NOT NULL
      AND to_tsvector('english', coalesce(f.topic,'') || ' ' || coalesce(f.content,''))
          @@ public.or_tsquery(p_query_text)
    LIMIT GREATEST(p_match_count * 3, 12)
  )
  SELECT f.id, f.topic, f.content, f.source, f.subject, f.confidence,
         COALESCE(v.similarity, 0)::double precision,
         l.rank::integer, v.rank::integer,
         (COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + l.rank), 0))::double precision AS fused
  FROM filtered f
  LEFT JOIN vec v ON v.id = f.id
  LEFT JOIN lex l ON l.id = f.id
  WHERE v.rank IS NOT NULL OR l.rank IS NOT NULL
  ORDER BY fused DESC
  LIMIT p_match_count;
$function$;

CREATE FUNCTION public.match_agent_knowledge(
  p_agent_id        uuid,
  p_query_embedding vector,
  p_match_count     integer DEFAULT 6,
  p_query_text      text    DEFAULT NULL,
  p_subject         text    DEFAULT NULL
)
RETURNS TABLE(id uuid, topic text, content text, chunk_type text, subject text,
              confidence numeric, similarity double precision, fused double precision)
LANGUAGE sql STABLE AS $function$
  WITH filtered AS (
    SELECT k.id, k.topic, k.content, k.chunk_type, k.subject, k.confidence, k.embedding
    FROM edu.agent_knowledge k
    WHERE k.agent_id = p_agent_id
      AND public.subject_matches(k.subject, p_subject)
  ),
  vec AS (
    SELECT f.id, 1 - (f.embedding <=> p_query_embedding) AS similarity,
           row_number() OVER (ORDER BY f.embedding <=> p_query_embedding) AS rank
    FROM filtered f
    WHERE p_query_embedding IS NOT NULL AND f.embedding IS NOT NULL
    LIMIT GREATEST(p_match_count * 3, 12)
  ),
  lex AS (
    SELECT f.id,
           row_number() OVER (
             ORDER BY ts_rank(to_tsvector('english', coalesce(f.topic,'') || ' ' || coalesce(f.content,'')),
                              public.or_tsquery(p_query_text)) DESC) AS rank
    FROM filtered f
    WHERE public.or_tsquery(p_query_text) IS NOT NULL
      AND to_tsvector('english', coalesce(f.topic,'') || ' ' || coalesce(f.content,''))
          @@ public.or_tsquery(p_query_text)
    LIMIT GREATEST(p_match_count * 3, 12)
  )
  SELECT f.id, f.topic, f.content, f.chunk_type, f.subject, f.confidence,
         COALESCE(v.similarity, 0)::double precision,
         (COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + l.rank), 0))::double precision AS fused
  FROM filtered f
  LEFT JOIN vec v ON v.id = f.id
  LEFT JOIN lex l ON l.id = f.id
  WHERE v.rank IS NOT NULL OR l.rank IS NOT NULL
  ORDER BY fused DESC
  LIMIT p_match_count;
$function$;

CREATE FUNCTION public.match_training_chunks(
  p_teacher_id      uuid,
  p_query_embedding vector,
  p_match_count     integer DEFAULT 6,
  p_query_text      text    DEFAULT NULL,
  p_subject         text    DEFAULT NULL
)
RETURNS TABLE(id uuid, chunk_text text, chunk_type text, metadata jsonb,
              similarity double precision, fused double precision)
LANGUAGE sql STABLE AS $function$
  WITH filtered AS (
    SELECT c.id, c.chunk_text, c.chunk_type, c.metadata, c.embedding
    FROM edu.training_chunks c
    WHERE c.teacher_id = p_teacher_id
      -- training_chunks has no subject column; it is written into metadata by
      -- the ingest, so that is where it is read from.
      AND public.subject_matches(c.metadata->>'subject', p_subject)
  ),
  vec AS (
    SELECT f.id, 1 - (f.embedding <=> p_query_embedding) AS similarity,
           row_number() OVER (ORDER BY f.embedding <=> p_query_embedding) AS rank
    FROM filtered f
    WHERE p_query_embedding IS NOT NULL AND f.embedding IS NOT NULL
    LIMIT GREATEST(p_match_count * 3, 12)
  ),
  lex AS (
    SELECT f.id,
           row_number() OVER (
             ORDER BY ts_rank(to_tsvector('english', coalesce(f.chunk_text,'')),
                              public.or_tsquery(p_query_text)) DESC) AS rank
    FROM filtered f
    WHERE public.or_tsquery(p_query_text) IS NOT NULL
      AND to_tsvector('english', coalesce(f.chunk_text,''))
          @@ public.or_tsquery(p_query_text)
    LIMIT GREATEST(p_match_count * 3, 12)
  )
  SELECT f.id, f.chunk_text, f.chunk_type, f.metadata,
         COALESCE(v.similarity, 0)::double precision,
         (COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + l.rank), 0))::double precision AS fused
  FROM filtered f
  LEFT JOIN vec v ON v.id = f.id
  LEFT JOIN lex l ON l.id = f.id
  WHERE v.rank IS NOT NULL OR l.rank IS NOT NULL
  ORDER BY fused DESC
  LIMIT p_match_count;
$function$;

COMMENT ON FUNCTION public.match_student_knowledge(uuid, vector, integer, text, text, text[]) IS
  'Hybrid retrieval over a learner''s own notes: vector + full-text, fused by Reciprocal Rank Fusion (k=60), with optional subject filter and tag exclusion. Either arm alone still returns rows.';

-- Verify:
--   SELECT topic, round(similarity::numeric,3) sim, vector_rank, lexical_rank, round(fused::numeric,5)
--   FROM match_student_knowledge(
--     (SELECT id FROM users LIMIT 1), NULL, 6, 'simple interest formula', 'Mathematics', NULL);
