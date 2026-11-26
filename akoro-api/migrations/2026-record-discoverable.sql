-- =============================================================
-- 2026-record-discoverable.sql
--
-- The Premium sharing choice. Uploads are public for free users and
-- private for Premium subscribers (modules/records/access.js); a
-- Premium subscriber may now set ONE record public as a choice.
-- `discoverable` is that choice: false (the default) keeps a Premium
-- record inside its owner's library; true lets it ride the Discover
-- feed, platform search and cross-learner Ask exactly like a free
-- user's upload. It never overrides `private` — a private record
-- (a chat upload, D53) stays its owner's alone either way.
-- Idempotent.
-- =============================================================

ALTER TABLE edu.records ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT false;

-- Platform (Discover) hybrid search honours the same choice: a Premium
-- owner's chunks stay excluded UNLESS the record is set public. Same
-- signature as 2026-platform-hybrid-search.sql; only the filter moves.
CREATE OR REPLACE FUNCTION public.match_platform_chunks(
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
      AND (NOT (r.user_id = ANY (COALESCE(p_premium_user_ids, '{}'))) OR r.discoverable = true)
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

COMMENT ON FUNCTION public.match_platform_chunks(uuid, vector, text, integer, uuid[]) IS
  'Hybrid RRF over other learners'' public upload/paste chunks. Excludes requester and private/deleted records; Premium owners excluded unless the record is discoverable (set public by its owner). Callers re-verify every hit.';

NOTIFY pgrst, 'reload schema';
