-- 2026-assessment-gateway.sql
-- Session Assessment Gateway: proctored assessments run by the Sergeant agent.
-- One row per assessment attempt. Proctoring signals + cheat events are
-- aggregated server-side; the Q&A transcript and final verdict are persisted
-- so results show in the learner's history and instructors can review flags.
-- Safe to re-run.
--
-- ⚠️  REQUIRES the `edu` schema to be in the project's Exposed schemas list,
--     or every db.schema("edu") call fails with PGRST106 "Invalid schema: edu".
--     See migrations/2026-expose-edu-schema.sql.

CREATE SCHEMA IF NOT EXISTS edu;

CREATE TABLE IF NOT EXISTS edu.assessment_sessions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id            TEXT NOT NULL,
    student_agent_id      UUID,
    topic                 TEXT NOT NULL,
    subject               TEXT,

    -- lifecycle: active → completed | abandoned | terminated (kicked for cheating)
    status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed','abandoned','terminated')),

    -- Identity verification reference (registered at session start)
    reference_image_url   TEXT,
    identity_verified     BOOLEAN NOT NULL DEFAULT false,

    -- Q&A transcript (typed block array, same shape the UI renders)
    block_history         JSONB NOT NULL DEFAULT '[]'::jsonb,
    questions             JSONB NOT NULL DEFAULT '[]'::jsonb,   -- generated question bank

    -- Proctoring: discrete flagged events + rolling aggregate stats
    cheat_events          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ts,type,severity,detail}]
    proctoring_signals    JSONB NOT NULL DEFAULT '{}'::jsonb,   -- rolling counts/ratios

    -- Final scoring
    assessment_score      INTEGER,                              -- 0-100 academic score
    cheat_probability     REAL NOT NULL DEFAULT 0,              -- 0-1 temporal score
    final_verdict         TEXT,                                 -- pass | fail | flagged | terminated
    verdict_detail        TEXT,                                 -- Sergeant's written verdict

    started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at          TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessment_sessions_student
    ON edu.assessment_sessions(student_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_sessions_status
    ON edu.assessment_sessions(status);

GRANT USAGE ON SCHEMA edu TO service_role;
GRANT ALL ON edu.assessment_sessions TO service_role;
