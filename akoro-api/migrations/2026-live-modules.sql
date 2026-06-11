-- 2026-live-modules.sql
-- Live-class curriculum structure: modules (= weeks) grouping dated sessions,
-- per-session materials, and a reusable schedule config on the course.
-- Safe to re-run.

-- ── Sessions belong to a module (week) and have an order within it ──────────
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS module_id   UUID REFERENCES course_modules(id) ON DELETE SET NULL;
ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS order_index INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_live_sessions_module ON live_sessions(module_id, order_index);

-- ── Persisted recurrence config so a schedule can be edited/regenerated ─────
-- { frequency, daysOfWeek:[1,3,5], time:"16:00", durationMin:60, startDate, weeks }
ALTER TABLE courses ADD COLUMN IF NOT EXISTS schedule_config JSONB;

-- ── Per-session learning materials (files / links / notes) ──────────────────
CREATE TABLE IF NOT EXISTS session_materials (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'file' CHECK (kind IN ('file', 'link', 'note')),
    url         TEXT,
    body        TEXT,                 -- free text for 'note' kind
    file_type   TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_materials_session ON session_materials(session_id, order_index);
