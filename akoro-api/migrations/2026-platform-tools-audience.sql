-- =============================================================
-- 2026-platform-tools-audience.sql
-- Who a catalogue listing is offered to.
--
-- The instructor app and the school app both read GET /api/instructor/tools,
-- so until now every listing was shown to both. This lets a listing be
-- targeted: school-only management modules, instructor-only teaching tools,
-- or (default) both.
--
-- Idempotent; safe to re-run.
-- =============================================================

ALTER TABLE edu.platform_tools
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'both';

-- Recreate by name so re-runs don't accumulate duplicates.
ALTER TABLE edu.platform_tools DROP CONSTRAINT IF EXISTS platform_tools_audience_check;
ALTER TABLE edu.platform_tools ADD  CONSTRAINT platform_tools_audience_check
  CHECK (audience IN ('both', 'instructors', 'schools'));

-- Existing rows were visible to everyone; keep it that way rather than
-- silently hiding anything already listed.
UPDATE edu.platform_tools SET audience = 'both' WHERE audience IS NULL;

CREATE INDEX IF NOT EXISTS idx_platform_tools_audience
  ON edu.platform_tools (audience) WHERE is_active = true;

NOTIFY pgrst, 'reload schema';
