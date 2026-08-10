-- =============================================================
-- 2026-knowledge-hierarchy.sql
--
-- Subtopics, a working upsert key, and the constraint that was missing.
--
-- Four problems, one shape between them: the knowledge tables had no identity.
--
--   1. saveStudentKnowledge upserts with onConflict "student_id,topic" and NO
--      SUCH CONSTRAINT EXISTS. Every call has been returning
--
--          42P10  there is no unique or exclusion constraint matching the
--                 ON CONFLICT specification
--
--      and both callers swallow it into a console.warn. edu.student_knowledge
--      has therefore never been written by a teaching session — every strength
--      a learner demonstrated was dropped. It is also the table battle agents
--      now recall from, so agents answer "nothing in memory" for learners who
--      have been taught plenty.
--
--   2. Nothing stopped duplicate (student_id, topic) rows, so the same topic
--      could accumulate silently — and saveAgentKnowledge's .single() lookup
--      returns null when it matches MORE than one, which inserts yet another.
--
--   3. There was no subtopic. A battle question on "Family Roles" inside a
--      battle on "Family" wrote "Family Roles" as a top-level topic, unrelated
--      to "Family" and to its five siblings. edu.knowledge_confidence models
--      this correctly — UNIQUE(student_id, topic, subtopic) — and is the one
--      table battles never touch.
--
--   4. Two confidence models on different scales: student_knowledge 0..1,
--      knowledge_confidence 0..100. Both are kept — they answer different
--      questions — but battles now write both, and the scales are documented
--      where someone will actually read them.
--
-- subtopic is NOT NULL DEFAULT '' rather than nullable. In Postgres NULLs are
-- distinct, so a nullable column in a unique key would let unlimited rows
-- through with subtopic NULL — exactly the duplicates this is meant to stop.
-- Empty string means "the topic itself", and it lets PostgREST target the
-- constraint by column name, which an expression index would not.
-- =============================================================

ALTER TABLE edu.student_knowledge ADD COLUMN IF NOT EXISTS subtopic TEXT;
ALTER TABLE edu.agent_knowledge   ADD COLUMN IF NOT EXISTS subtopic TEXT;

UPDATE edu.student_knowledge SET subtopic = '' WHERE subtopic IS NULL;
UPDATE edu.agent_knowledge   SET subtopic = '' WHERE subtopic IS NULL;

ALTER TABLE edu.student_knowledge ALTER COLUMN subtopic SET DEFAULT '';
ALTER TABLE edu.agent_knowledge   ALTER COLUMN subtopic SET DEFAULT '';

DO $$ BEGIN
  ALTER TABLE edu.student_knowledge ALTER COLUMN subtopic SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE edu.agent_knowledge ALTER COLUMN subtopic SET NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

-- ── Dedupe before the key goes on ────────────────────────────────────────────
-- Keep the row with the most content, breaking ties on most recently updated:
-- if the same topic was written twice, the fuller note is the one that survived
-- least damage from the overwrite-on-reinforce bug this migration accompanies.
-- Anything dropped here was unreachable anyway — the retrieval RPCs return one
-- row per id, and a duplicate could only ever have taken a slot from a
-- different topic.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY student_id, topic, COALESCE(subtopic, '')
    ORDER BY length(COALESCE(content, '')) DESC, updated_at DESC NULLS LAST, id
  ) AS rn
  FROM edu.student_knowledge
)
DELETE FROM edu.student_knowledge k USING ranked r WHERE k.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY agent_id, topic, COALESCE(subtopic, '')
    ORDER BY length(COALESCE(content, '')) DESC, updated_at DESC NULLS LAST, id
  ) AS rn
  FROM edu.agent_knowledge
)
DELETE FROM edu.agent_knowledge k USING ranked r WHERE k.id = r.id AND r.rn > 1;

-- ── The key ──────────────────────────────────────────────────────────────────
-- Subject is deliberately NOT in the key. It is free text that drifts between
-- "Maths" and "Mathematics" — keying on it would make the drift produce
-- duplicates, which is the bug rather than the fix. It stays an attribute that
-- the upsert updates. edu.knowledge_confidence made the same call.
DO $$ BEGIN
  ALTER TABLE edu.student_knowledge
    ADD CONSTRAINT student_knowledge_student_topic_subtopic_key
    UNIQUE (student_id, topic, subtopic);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE edu.agent_knowledge
    ADD CONSTRAINT agent_knowledge_agent_topic_subtopic_key
    UNIQUE (agent_id, topic, subtopic);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- ── Search over the fuller label ─────────────────────────────────────────────
-- The lexical arm indexes topic + content; with a subtopic carrying the
-- specific idea ("Family Roles" under "Family"), leaving it out would make the
-- most precise word in the row invisible to keyword search.
DROP INDEX IF EXISTS edu.idx_student_knowledge_fts;
DROP INDEX IF EXISTS edu.idx_agent_knowledge_fts;
CREATE INDEX IF NOT EXISTS idx_student_knowledge_fts ON edu.student_knowledge
  USING gin (to_tsvector('english',
    coalesce(topic,'') || ' ' || coalesce(subtopic,'') || ' ' || coalesce(content,'')));
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_fts ON edu.agent_knowledge
  USING gin (to_tsvector('english',
    coalesce(topic,'') || ' ' || coalesce(subtopic,'') || ' ' || coalesce(content,'')));

-- Rolling a topic up from its subtopics — "how is this learner doing on Family"
-- — is now answerable, and was not before.
CREATE INDEX IF NOT EXISTS idx_student_knowledge_topic_roll
  ON edu.student_knowledge (student_id, topic, subtopic);

-- ── Retrieval, carrying the subtopic through ─────────────────────────────────
-- Sweep every overload, do not name them.
--
-- Naming them is what broke the SECOND production deploy. 2026-base-schema.sql
-- recreates the original three-argument function on every run, and the
-- seven-argument one below survives from the previous deploy — so by the time
-- this file ran there were arities no explicit DROP list had been told about.
-- One got left behind, CREATE added another beside it, and the next unqualified
-- COMMENT ON FUNCTION halted the deploy with "function name is not unique".
--
-- A migration cannot know the shape of the database it arrives at. It can only
-- guarantee the shape it leaves.
DO $drop$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'match_student_knowledge'
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
  p_exclude_tags    text[]  DEFAULT NULL,
  p_topic           text    DEFAULT NULL
)
RETURNS TABLE(id uuid, topic text, subtopic text, content text, source text, subject text,
              confidence numeric, similarity double precision,
              lexical_rank integer, vector_rank integer, fused double precision)
LANGUAGE sql STABLE AS $function$
  WITH filtered AS (
    SELECT k.id, k.topic, k.subtopic, k.content, k.source, k.subject, k.confidence, k.embedding
    FROM edu.student_knowledge k
    WHERE k.student_id = p_student_id
      AND public.subject_matches(k.subject, p_subject)
      AND (p_exclude_tags IS NULL OR NOT (k.tags && p_exclude_tags))
      -- Optional roll-up: everything under one topic, whatever the subtopic.
      AND (p_topic IS NULL OR k.topic ILIKE p_topic)
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
             ORDER BY ts_rank(to_tsvector('english',
                        coalesce(f.topic,'') || ' ' || coalesce(f.subtopic,'') || ' ' || coalesce(f.content,'')),
                      public.or_tsquery(p_query_text)) DESC) AS rank
    FROM filtered f
    WHERE public.or_tsquery(p_query_text) IS NOT NULL
      AND to_tsvector('english',
            coalesce(f.topic,'') || ' ' || coalesce(f.subtopic,'') || ' ' || coalesce(f.content,''))
          @@ public.or_tsquery(p_query_text)
    LIMIT GREATEST(p_match_count * 3, 12)
  )
  SELECT f.id, f.topic, f.subtopic, f.content, f.source, f.subject, f.confidence,
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

-- ── knowledge_confidence, so battles can feed it ─────────────────────────────
-- student_id is TEXT on this table and UUID everywhere else. Not changed here:
-- it is written by three modules already and a type change is its own migration
-- with its own blast radius. Callers cast, and this comment exists so the next
-- person does not spend an afternoon on it.
COMMENT ON COLUMN edu.knowledge_confidence.confidence IS
  'PERCENT, 0..100. Not the same scale as edu.student_knowledge.confidence, which is 0..1. Both are real and mean different things: this one is assessment-derived mastery per subtopic, that one is retrieval-weighting for a note.';
COMMENT ON COLUMN edu.student_knowledge.confidence IS
  'FRACTION, 0..1. See edu.knowledge_confidence.confidence, which is a percentage — the two are not interchangeable.';
COMMENT ON COLUMN edu.student_knowledge.subtopic IS
  'The specific idea within the topic; empty string means the topic itself. Part of the upsert key, so it cannot be NULL.';

-- Verify:
--   SELECT topic, subtopic, left(content, 40), confidence
--   FROM edu.student_knowledge ORDER BY topic, subtopic LIMIT 20;
--   SELECT topic, count(*) AS subtopics, round(avg(confidence),2)
--   FROM edu.student_knowledge GROUP BY topic ORDER BY 2 DESC LIMIT 10;
