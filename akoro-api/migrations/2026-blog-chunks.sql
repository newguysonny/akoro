-- =============================================================
-- 2026-blog-chunks.sql — Grand Plan §7.14 (D35): blog passage search.
-- Published posts are split into passages (one per heading section, long
-- sections split again) so the agent can search article BODIES, not only
-- titles, and quote a passage with its post and heading. Indexed on
-- publish/update (modules/adaptive-learning/blogResearch.js indexBlogPost);
-- vectors are filled by lib/embeddingSweeper.js like every other store.
-- match_blog_chunks: hybrid RRF (vector + stemmed lexical), published only.
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS content.blog_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id      uuid NOT NULL REFERENCES content.blog_posts(id) ON DELETE CASCADE,
  ord          integer NOT NULL,
  heading      text,
  chunk_text   text NOT NULL,
  embedding    vector(1536),
  embedded_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, ord)
);
CREATE INDEX IF NOT EXISTS idx_blog_chunks_post ON content.blog_chunks (post_id);
CREATE INDEX IF NOT EXISTS idx_blog_chunks_fts ON content.blog_chunks USING gin (to_tsvector('english', chunk_text));

CREATE OR REPLACE FUNCTION public.match_blog_chunks(
  p_query_embedding vector,
  p_match_count     integer DEFAULT 6,
  p_query_text      text    DEFAULT NULL,
  p_category        text    DEFAULT NULL
)
RETURNS TABLE(post_id uuid, slug text, title text, category text, heading text,
              chunk_text text, similarity double precision, fused double precision)
LANGUAGE sql STABLE AS $function$
  WITH filtered AS (
    SELECT c.id, c.post_id, c.heading, c.chunk_text, c.embedding,
           p.slug, p.title, p.category
    FROM content.blog_chunks c
    JOIN content.blog_posts p ON p.id = c.post_id
    WHERE p.status = 'published'
      AND (p_category IS NULL OR p.category = p_category)
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
      AND to_tsvector('english', f.chunk_text) @@ public.or_tsquery(p_query_text)
    LIMIT GREATEST(p_match_count * 3, 12)
  )
  SELECT f.post_id, f.slug, f.title, f.category, f.heading, f.chunk_text,
         COALESCE(v.similarity, 0)::double precision,
         (COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + l.rank), 0))::double precision AS fused
  FROM filtered f
  LEFT JOIN vec v ON v.id = f.id
  LEFT JOIN lex l ON l.id = f.id
  WHERE v.rank IS NOT NULL OR l.rank IS NOT NULL
  ORDER BY fused DESC
  LIMIT p_match_count;
$function$;

GRANT SELECT, INSERT, UPDATE, DELETE ON content.blog_chunks TO service_role;
GRANT EXECUTE ON FUNCTION public.match_blog_chunks(vector, integer, text, text) TO service_role;
NOTIFY pgrst, 'reload schema';
