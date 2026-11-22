-- Platform (Discover) hybrid search (2026-11-22).
--
-- The own-Library search is RRF hybrid; Discover was lexical-only. This adds
-- the same RRF (vector + stemmed lexical) over OTHER learners' public chunks.
-- Access is enforced twice: in this function (owner/requester, private,
-- deleted, kind, Premium owners) and again in JavaScript before any hit is
-- returned. A NULL query vector is a valid state (one unvote), never an error.
--
-- Premium owners are passed in by the caller (activePremiumUserIds) rather
-- than duplicating the tier/subscription rule in SQL.
DROP FUNCTION IF EXISTS public.match_platform_chunks(uuid, vector, text, integer, uuid[]);

CREATE FUNCTION public.match_platform_chunks(
  p_user_id          uuid,
  p_query_embedding  vector,
  p_query_text       text,
  p_match_count      integer DEFAULT 40,
  p_premium_user_ids uuid[]  DEFAULT '{}'
)
RETURNS TABLE(record_id uuid, record_name text, record_kind text, owner_id uuid,
              chunk_kind text, page_number integer, chunk_text text,
              similarity double precision, fused double precision)
LANGUAGE sql STABLE AS $function$
  WITH filtered AS (
    SELECT c.id, c.record_id, c.kind, c.page_number, c.chunk_text, c.embedding,
           r.name AS record_name, r.kind AS record_kind, r.user_id AS owner_id
    FROM edu.record_chunks c
    JOIN edu.records r ON r.id = c.record_id
    WHERE r.private = false
      AND r.deleted_at IS NULL
      AND r.kind IN ('upload', 'paste')
      AND r.user_id <> p_user_id
      AND c.user_id <> p_user_id
      AND NOT (r.user_id = ANY (COALESCE(p_premium_user_ids, '{}')))
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
  SELECT f.record_id, f.record_name, f.record_kind, f.owner_id,
         f.kind, f.page_number, f.chunk_text,
         COALESCE(v.similarity, 0)::double precision,
         (COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + l.rank), 0))::double precision AS fused
  FROM filtered f
  LEFT JOIN vec v ON v.id = f.id
  LEFT JOIN lex l ON l.id = f.id
  WHERE v.rank IS NOT NULL OR l.rank IS NOT NULL
  ORDER BY fused DESC
  LIMIT p_match_count;
$function$;

GRANT EXECUTE ON FUNCTION public.match_platform_chunks(uuid, vector, text, integer, uuid[]) TO service_role;

COMMENT ON FUNCTION public.match_platform_chunks(uuid, vector, text, integer, uuid[]) IS
  'Hybrid RRF over other learners'' public upload/paste chunks. Excludes requester, private/deleted records and Premium owners; callers re-verify every hit.';
