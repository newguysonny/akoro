-- ============================================================================
-- user-knowledge.sql — everything a single learner "knows", by email OR username
--
-- Usage (psql):
--     psql "$DATABASE_URL" -v ident="ada@example.com" -f scripts/sql/user-knowledge.sql
--     psql "$DATABASE_URL" -v ident="ada"             -f scripts/sql/user-knowledge.sql
--
-- In the Supabase SQL editor, replace  :'ident'  with a quoted literal.
--
-- The four places knowledge lives:
--   edu.student_knowledge    — what the learner has been taught (the brain)
--   edu.agent_knowledge      — what their AI agent absorbed while being taught
--   edu.knowledge_confidence — per topic × subtopic mastery 0-100 + decay schedule
--   edu.adaptive_sessions    — the sessions that produced all of the above
-- NOTE: knowledge_confidence.student_id is TEXT, not UUID — hence the cast.
-- ============================================================================

\set QUIET on
\set ON_ERROR_STOP on
\set QUIET off

-- ── 0. Who are we talking about? ────────────────────────────────────────────
SELECT id, email, username, full_name, role, created_at
  FROM public.users
 WHERE email = :'ident' OR username = :'ident';

-- ── 1. The knowledge bank ───────────────────────────────────────────────────
SELECT k.topic,
       k.subject,
       k.source,
       ROUND(k.confidence::numeric, 2)         AS confidence,   -- 0-1 scale
       k.tags,
       length(k.content)                        AS content_chars,
       (k.embedding IS NOT NULL)                AS embedded,
       left(k.content, 240)                     AS content_preview,
       k.updated_at
  FROM edu.student_knowledge k
  JOIN public.users u ON u.id = k.student_id
 WHERE u.email = :'ident' OR u.username = :'ident'
 ORDER BY k.updated_at DESC;

-- ── 2. Mastery per topic × subtopic (0-100) + when it needs revision ────────
SELECT c.subject,
       c.topic,
       c.subtopic,
       c.confidence,
       c.prev_confidence,
       c.assess_count,
       c.passed_count,
       c.misconceptions,
       c.last_assessed,
       c.next_review_due,
       (c.next_review_due IS NOT NULL AND c.next_review_due <= now()) AS due_for_revision
  FROM edu.knowledge_confidence c
  JOIN public.users u ON u.id::text = c.student_id
 WHERE u.email = :'ident' OR u.username = :'ident'
 ORDER BY c.subject, c.topic, c.subtopic;

-- ── 3. What the learner's AI agent picked up ────────────────────────────────
SELECT a.topic,
       a.subject,
       a.chunk_type,
       ROUND(a.confidence::numeric, 2) AS confidence,
       a.times_seen,
       a.last_seen_at,
       left(a.content, 240)            AS content_preview
  FROM edu.agent_knowledge a
  JOIN public.users u ON u.id = a.student_id
 WHERE u.email = :'ident' OR u.username = :'ident'
 ORDER BY a.last_seen_at DESC;

-- ── 4. Sessions that produced it (this is what the Sessions tab lists) ──────
SELECT s.id,
       s.topic,
       s.subject,
       s.status,
       jsonb_array_length(COALESCE(s.subtopics, '[]'::jsonb))     AS subtopic_count,
       jsonb_array_length(COALESCE(s.block_history, '[]'::jsonb)) AS block_count,
       s.started_at,
       s.completed_at,
       s.updated_at
  FROM edu.adaptive_sessions s
  JOIN public.users u ON u.id = s.student_id
 WHERE u.email = :'ident' OR u.username = :'ident'
 ORDER BY s.updated_at DESC;

-- ── 5. One-line rollup per topic ────────────────────────────────────────────
WITH u AS (
  SELECT id FROM public.users WHERE email = :'ident' OR username = :'ident'
)
SELECT COALESCE(k.topic, c.topic)                       AS topic,
       COALESCE(k.subject, c.subject)                   AS subject,
       COALESCE(k.chunks, 0)                            AS knowledge_chunks,
       COALESCE(c.subtopics, 0)                         AS subtopics_assessed,
       ROUND(c.avg_confidence, 1)                       AS avg_mastery_pct,
       c.next_due
  FROM (
        SELECT topic, subject, count(*) AS chunks
          FROM edu.student_knowledge
         WHERE student_id IN (SELECT id FROM u)
         GROUP BY topic, subject
       ) k
  FULL JOIN (
        SELECT topic, subject,
               count(*)          AS subtopics,
               avg(confidence)   AS avg_confidence,
               min(next_review_due) AS next_due
          FROM edu.knowledge_confidence
         WHERE student_id IN (SELECT id::text FROM u)
         GROUP BY topic, subject
       ) c
    ON c.topic = k.topic AND c.subject IS NOT DISTINCT FROM k.subject
 ORDER BY 1;
