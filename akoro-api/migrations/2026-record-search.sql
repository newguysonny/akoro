-- =============================================================
-- 2026-record-search.sql
--
-- Semantic search over the learner's library: every record becomes
-- findable by WHAT IT SAYS, not just by its filename.
--
-- The stores the hybrid-retrieval migration covers (student notes,
-- agent knowledge, training chunks) are things the learner or their
-- agent WROTE. The library is different: it is things the learner
-- BROUGHT — uploads, pastes, links — and until now it could only be
-- browsed. A scanned PDF about "arterial blood gas interpretation"
-- was invisible to a search for "ABG values" unless its filename
-- happened to say so.
--
-- So: chunks. Every record contributes the text that is knowable
-- about it —
--
--   kind 'name'       the record's own name (every record gets one,
--                     so a bare shelf is still searchable)
--   kind 'paste'      a slice of the pasted text
--   kind 'page'       one extraction page's markdown (the shared
--                     content cache — parsed once, searched forever)
--   kind 'transcript' a window of the A/V transcript (with its
--                     start_ms, so a hit can jump to the moment)
--
-- each as a row with a text-embedding-3-small vector (1536 — the
-- platform's one embedding dimension, same as every other store).
-- Indexing happens inline where the text is born (record create,
-- extraction batch, transcription job) and never blocks the response:
-- a failed embedding leaves the row vectorless, and the sweeper
-- (lib/embeddingSweeper.js — record_chunks is a STORE now) fills it
-- on its next pass. Inline for speed, sweep for correctness.
--
-- Search is the same RRF hybrid the other personal searches use:
-- cosine-ordered vectors fused with stemmed lexical ranks, because
-- embeddings are weak exactly where study material is strong — a
-- drug dose, a named act, an acronym. Reciprocal Rank Fusion only
-- consumes the two ORDERings, so no score scale is ever tuned; see
-- 2026-hybrid-retrieval.sql for the full argument.
--
-- Privacy rides the rows: every chunk carries user_id (the record's
-- owner) and the match function filters on it. Shared discovery files
-- stay OUT of another learner's search — if you open someone's shared
-- PDF, the extraction is cached and reused for you, but the searchable
-- chunks belong to the owner's record. Your library, your index.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.record_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  record_id    UUID NOT NULL REFERENCES edu.records(id) ON DELETE CASCADE,
  content_key  TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('name', 'paste', 'page', 'transcript')),
  page_number  INTEGER,
  start_ms     BIGINT,
  end_ms       BIGINT,
  chunk_text   TEXT NOT NULL,
  embedding    vector(1536),
  embedded_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vector arm — same bare ivfflat convention as the other stores.
CREATE INDEX IF NOT EXISTS idx_record_chunks_embedding
  ON edu.record_chunks USING ivfflat (embedding vector_cosine_ops);

-- A record's chunks die with it (FK CASCADE), and reindexing a record
-- deletes its rows first — both walk this index.
CREATE INDEX IF NOT EXISTS idx_record_chunks_record
  ON edu.record_chunks(record_id);

-- The sweeper's question — "which chunks have no vector" — must not
-- scan the corpus.
CREATE INDEX IF NOT EXISTS idx_record_chunks_needs_embed
  ON edu.record_chunks(created_at) WHERE embedding IS NULL AND embedded_at IS NULL;

-- ── The library search ───────────────────────────────────────────────────────
-- Dropped rather than replaced: a CREATE OR REPLACE with a changed signature
-- would leave the old arity behind as an overload for PostgREST to pick
-- between (the failure mode 2026-hybrid-retrieval.sql already paid for).
DO $drop$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'match_record_chunks'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END $drop$;

CREATE FUNCTION public.match_record_chunks(
  p_user_id         uuid,
  p_query_embedding vector,
  p_match_count     integer DEFAULT 8,
  p_query_text      text    DEFAULT NULL,
  p_record_id       uuid    DEFAULT NULL
)
RETURNS TABLE(record_id uuid, record_name text, record_kind text, mime text,
              chunk_kind text, page_number integer, start_ms bigint, end_ms bigint,
              chunk_text text, similarity double precision, fused double precision)
LANGUAGE sql STABLE AS $function$
  WITH filtered AS (
    SELECT c.id, c.record_id, c.kind, c.page_number, c.start_ms, c.end_ms,
           c.chunk_text, c.embedding,
           r.name AS record_name, r.kind AS record_kind, r.mime
    FROM edu.record_chunks c
    JOIN edu.records r ON r.id = c.record_id
    WHERE c.user_id = p_user_id
      AND (p_record_id IS NULL OR c.record_id = p_record_id)
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
             ORDER BY ts_rank(to_tsvector('english', f.chunk_text),
                              public.or_tsquery(p_query_text)) DESC) AS rank
    FROM filtered f
    WHERE public.or_tsquery(p_query_text) IS NOT NULL
      AND to_tsvector('english', f.chunk_text)
          @@ public.or_tsquery(p_query_text)
    LIMIT GREATEST(p_match_count * 3, 12)
  )
  SELECT f.record_id, f.record_name, f.record_kind, f.mime,
         f.kind, f.page_number, f.start_ms, f.end_ms, f.chunk_text,
         COALESCE(v.similarity, 0)::double precision,
         (COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + l.rank), 0))::double precision AS fused
  FROM filtered f
  LEFT JOIN vec v ON v.id = f.id
  LEFT JOIN lex l ON l.id = f.id
  WHERE v.rank IS NOT NULL OR l.rank IS NOT NULL
  ORDER BY fused DESC
  LIMIT p_match_count;
$function$;

COMMENT ON FUNCTION public.match_record_chunks(uuid, vector, integer, text, uuid) IS
  'Hybrid (RRF of cosine-vector and stemmed-lexical ranks) search over one learner''s record chunks. p_query_embedding may be NULL (lexical-only fallback); p_record_id narrows to one record.';
