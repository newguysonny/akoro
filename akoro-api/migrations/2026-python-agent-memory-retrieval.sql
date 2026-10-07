-- =============================================================
-- 2026-python-agent-memory-retrieval.sql
-- Semantic + lexical retrieval for the additive Python agent's bounded,
-- learner-owned long-term context. Raw chat messages remain relational and are
-- never embedded; only compact memory notes and conversation summaries are.
-- =============================================================

ALTER TABLE edu.learner_agent_memories
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

ALTER TABLE edu.learner_agent_conversation_summaries
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_learner_agent_memories_embedding
  ON edu.learner_agent_memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50)
  WHERE embedding IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_learner_agent_conversation_summaries_embedding
  ON edu.learner_agent_conversation_summaries USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50)
  WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learner_agent_memories_fts
  ON edu.learner_agent_memories USING gin (
    to_tsvector('english', coalesce(topic, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(content, ''))
  ) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_learner_agent_conversation_summaries_fts
  ON edu.learner_agent_conversation_summaries USING gin (
    to_tsvector('english', coalesce(summary, ''))
  );

CREATE INDEX IF NOT EXISTS idx_learner_agent_memories_needs_embed
  ON edu.learner_agent_memories (updated_at)
  WHERE status = 'active' AND embedding IS NULL AND embedded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_learner_agent_conversation_summaries_needs_embed
  ON edu.learner_agent_conversation_summaries (updated_at)
  WHERE embedding IS NULL AND embedded_at IS NULL;

-- Hybrid reciprocal-rank retrieval. Vector search finds paraphrases; lexical
-- search preserves exact formulas, named terms, and short study phrases.
-- `public.or_tsquery` and `public.subject_matches` were introduced by the
-- earlier hybrid-retrieval migration, which precedes this migration in the
-- deployment manifest.
CREATE OR REPLACE FUNCTION public.match_learner_agent_memory(
  p_user_id          uuid,
  p_query_embedding  vector,
  p_match_count      integer DEFAULT 6,
  p_query_text       text DEFAULT NULL,
  p_subject          text DEFAULT NULL
)
RETURNS TABLE(
  memory_type text,
  id uuid,
  chat_session_id uuid,
  kind text,
  topic text,
  subject text,
  content text,
  similarity double precision,
  lexical_rank integer,
  vector_rank integer,
  fused double precision
)
LANGUAGE sql STABLE AS $function$
  WITH candidates AS (
    SELECT
      'memory'::text AS memory_type,
      m.id,
      m.chat_session_id,
      m.kind,
      m.topic,
      m.subject,
      m.content,
      m.embedding
    FROM edu.learner_agent_memories m
    WHERE m.user_id = p_user_id
      AND m.status = 'active'
      AND public.subject_matches(m.subject, p_subject)

    UNION ALL

    SELECT
      'conversation_summary'::text AS memory_type,
      s.chat_session_id AS id,
      s.chat_session_id,
      'conversation_summary'::text AS kind,
      NULL::text AS topic,
      NULL::text AS subject,
      s.summary AS content,
      s.embedding
    FROM edu.learner_agent_conversation_summaries s
    WHERE s.user_id = p_user_id
  ),
  vec AS (
    SELECT
      c.memory_type,
      c.id,
      1 - (c.embedding <=> p_query_embedding) AS similarity,
      row_number() OVER (ORDER BY c.embedding <=> p_query_embedding) AS rank
    FROM candidates c
    WHERE p_query_embedding IS NOT NULL AND c.embedding IS NOT NULL
    LIMIT GREATEST(LEAST(COALESCE(p_match_count, 6), 8) * 3, 18)
  ),
  lex AS (
    SELECT
      c.memory_type,
      c.id,
      row_number() OVER (
        ORDER BY ts_rank_cd(
          to_tsvector('english', coalesce(c.topic, '') || ' ' || coalesce(c.subject, '') || ' ' || c.content),
          public.or_tsquery(p_query_text)
        ) DESC
      ) AS rank
    FROM candidates c
    WHERE public.or_tsquery(p_query_text) IS NOT NULL
      AND to_tsvector('english', coalesce(c.topic, '') || ' ' || coalesce(c.subject, '') || ' ' || c.content)
          @@ public.or_tsquery(p_query_text)
    LIMIT GREATEST(LEAST(COALESCE(p_match_count, 6), 8) * 3, 18)
  ),
  scores AS (
    SELECT memory_type, id,
           max(similarity) AS similarity,
           NULL::integer AS lexical_rank,
           min(rank)::integer AS vector_rank,
           sum(1.0 / (60 + rank))::double precision AS fused
    FROM vec
    GROUP BY memory_type, id

    UNION ALL

    SELECT memory_type, id,
           NULL::double precision AS similarity,
           min(rank)::integer AS lexical_rank,
           NULL::integer AS vector_rank,
           sum(1.0 / (60 + rank))::double precision AS fused
    FROM lex
    GROUP BY memory_type, id
  ),
  fused_scores AS (
    SELECT
      memory_type,
      id,
      max(similarity) AS similarity,
      min(lexical_rank) AS lexical_rank,
      min(vector_rank) AS vector_rank,
      sum(fused)::double precision AS fused
    FROM scores
    GROUP BY memory_type, id
  )
  SELECT
    c.memory_type,
    c.id,
    c.chat_session_id,
    c.kind,
    c.topic,
    c.subject,
    c.content,
    f.similarity,
    f.lexical_rank,
    f.vector_rank,
    f.fused
  FROM fused_scores f
  JOIN candidates c ON c.memory_type = f.memory_type AND c.id = f.id
  ORDER BY f.fused DESC, c.memory_type ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_match_count, 6), 8));
$function$;

COMMENT ON FUNCTION public.match_learner_agent_memory(uuid, vector, integer, text, text) IS
  'Learner-owned hybrid search over compact agent memory notes and conversation summaries; raw chat transcript is excluded.';
