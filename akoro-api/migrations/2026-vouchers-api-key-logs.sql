-- =============================================================
-- 2026-vouchers-api-key-logs.sql
-- Per-key request logging (mirrors an "API keys" / "Logs" page like most
-- API platforms): who created a key, and every /v1/validate call made with
-- it — so a startup can audit usage per key, not just per startup.
-- =============================================================

ALTER TABLE vouchers.api_keys ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES public.users(id);

-- Denormalised onto redemptions so per-key monthly spend is a cheap query.
ALTER TABLE vouchers.redemptions ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES vouchers.api_keys(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS vouchers.api_key_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id   UUID REFERENCES vouchers.api_keys(id) ON DELETE CASCADE,
  startup_id   UUID NOT NULL REFERENCES vouchers.startups(id) ON DELETE CASCADE,
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  status_code  INTEGER NOT NULL,
  reason       TEXT,
  ip_address   INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vouchers_api_key_logs_key     ON vouchers.api_key_logs (api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vouchers_api_key_logs_startup ON vouchers.api_key_logs (startup_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
