-- =============================================================
-- 2026-self-tooling-grants.sql
-- Admin grants for LOCKED self-tooling capabilities. An approval turns a
-- capability on for EVERYONE (plan decision S10); optional expiry; revoking
-- sets revoked_at (rows are never deleted — they are the audit trail).
-- The capability names themselves live in code
-- (modules/self-tooling/capabilities.js); forbidden ones can't be granted.
-- Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.capability_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capability  text NOT NULL CHECK (capability ~ '^[a-z_]+\.[a-z_]+$'),
  granted_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  request_id  uuid,
  note        text,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_capability_grants_active ON edu.capability_grants (capability) WHERE revoked_at IS NULL;
GRANT SELECT, INSERT, UPDATE ON edu.capability_grants TO service_role;
NOTIFY pgrst, 'reload schema';
