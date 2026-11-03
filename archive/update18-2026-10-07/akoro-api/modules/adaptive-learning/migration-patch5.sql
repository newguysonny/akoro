-- ================================================================
-- Migration Patch 5 — Per-subtopic confidence + decay
-- Extends the adaptive learning module with granular knowledge
-- tracking at the subtopic and objective level.
-- ================================================================

-- ── Table: edu.knowledge_confidence ─────────────────────────────
-- One row per (student × topic × subtopic).
-- Updated by Sargeant after every assessment gate.
-- Read by decay engine to apply Ebbinghaus forgetting curve.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS edu.knowledge_confidence (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      text          NOT NULL,
  agent_id        uuid,                          -- student's AI agent
  session_id      uuid,                          -- last session that assessed this
  topic           text          NOT NULL,
  subject         text          NOT NULL,
  subtopic        text          NOT NULL,
  objectives      jsonb         NOT NULL DEFAULT '[]',
  -- Confidence 0-100 (maps to Sargeant score × 100)
  confidence      numeric(5,2)  NOT NULL DEFAULT 20.0,
  prev_confidence numeric(5,2)  NOT NULL DEFAULT 20.0,
  -- Sargeant assessment tracking
  assess_count    int           NOT NULL DEFAULT 0,
  passed_count    int           NOT NULL DEFAULT 0,
  misconceptions  text[]        NOT NULL DEFAULT '{}',
  -- Ebbinghaus decay parameters
  -- decay_rate: daily decay as fraction (lower = slower)
  -- stability: increases with each pass, making decay slower
  decay_rate      numeric(5,4)  NOT NULL DEFAULT 0.0800,
  stability       numeric(5,3)  NOT NULL DEFAULT 1.000,
  -- Scheduling
  last_assessed   timestamptz   NOT NULL DEFAULT now(),
  next_review_due timestamptz,
  -- Meta
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  -- One row per student × topic × subtopic
  UNIQUE(student_id, topic, subtopic)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_kc_student_id    ON edu.knowledge_confidence(student_id);
CREATE INDEX IF NOT EXISTS idx_kc_next_review   ON edu.knowledge_confidence(next_review_due);
CREATE INDEX IF NOT EXISTS idx_kc_topic_subject ON edu.knowledge_confidence(topic, subject);
CREATE INDEX IF NOT EXISTS idx_kc_confidence    ON edu.knowledge_confidence(confidence);

-- ── Update adaptive_sessions: store block_history ────────────────
-- Stores the full typed block array so decay sessions can
-- reconstruct exact history (fallback: session_phase_progress).
ALTER TABLE edu.adaptive_sessions
  ADD COLUMN IF NOT EXISTS block_history jsonb DEFAULT '[]';

-- ── Update session_phase_progress: add confidence columns ────────
ALTER TABLE edu.session_phase_progress
  ADD COLUMN IF NOT EXISTS misconceptions text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reteach_focus  text;

-- ── Update edu.decay_notifications: add subtopic fields ──────────
ALTER TABLE edu.decay_notifications
  ADD COLUMN IF NOT EXISTS subtopic        text,
  ADD COLUMN IF NOT EXISTS prev_confidence numeric(5,2),
  ADD COLUMN IF NOT EXISTS misconceptions  text[] DEFAULT '{}';

-- ── Helper view: knowledge health per topic ───────────────────────
CREATE OR REPLACE VIEW edu.topic_knowledge_health AS
SELECT
  student_id,
  topic,
  subject,
  COUNT(*)                                        AS subtopic_count,
  ROUND(AVG(confidence), 1)                       AS avg_confidence,
  MIN(confidence)                                 AS min_confidence,
  MAX(confidence)                                 AS max_confidence,
  COUNT(*) FILTER (WHERE confidence < 35)         AS critical_count,
  COUNT(*) FILTER (WHERE confidence < 55)         AS high_count,
  MIN(next_review_due)                            AS next_review_due,
  MAX(last_assessed)                              AS last_assessed
FROM edu.knowledge_confidence
GROUP BY student_id, topic, subject;

-- ── Helper view: subtopics needing review ────────────────────────
CREATE OR REPLACE VIEW edu.subtopics_due_for_review AS
SELECT *
FROM edu.knowledge_confidence
WHERE
  next_review_due <= now() + interval '1 day'
  OR confidence < 55
ORDER BY confidence ASC, next_review_due ASC;
