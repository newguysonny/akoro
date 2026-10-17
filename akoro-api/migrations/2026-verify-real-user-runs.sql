-- =============================================================
-- 2026-verify-real-user-runs.sql
-- Verification Gate phase V4: one admin-approved write run on one REAL
-- account (modules/verify/realUser.js). Each row is the approval AND its
-- record: who approved it, which account, which scenario, why; single-use
-- (approved → running, claimed once) and short-lived (expires_at, 15 min);
-- then the verdict, whether cleanup left nothing behind, and how the account
-- owner was told (in-app, email, SMS). Idempotent.
-- =============================================================
CREATE TABLE IF NOT EXISTS edu.verify_real_user_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  admin_label  text NOT NULL,
  account_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scenario     text NOT NULL,
  reason       text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  status       text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','running','done','expired','failed')),
  expires_at   timestamptz NOT NULL,
  started_at   timestamptz,
  finished_at  timestamptz,
  run_id       uuid,
  verdict      text,
  cleanup_ok   boolean,
  residue      jsonb,
  notified     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verify_real_user_runs_created ON edu.verify_real_user_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_verify_real_user_runs_account ON edu.verify_real_user_runs (account_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON edu.verify_real_user_runs TO service_role;
NOTIFY pgrst, 'reload schema';
