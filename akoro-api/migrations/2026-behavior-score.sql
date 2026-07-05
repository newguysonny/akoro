-- =============================================================
-- 2026-behavior-score.sql
-- Behavior records gain a polarity (positive/negative) + points, so the
-- Student Profile Behavior tab can show a real +/- score, matching the
-- reference design. Additive + idempotent.
-- =============================================================

ALTER TABLE mgmt.behavior_records ADD COLUMN IF NOT EXISTS polarity text NOT NULL DEFAULT 'negative' CHECK (polarity IN ('positive','negative'));
ALTER TABLE mgmt.behavior_records ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 1;

NOTIFY pgrst, 'reload schema';
