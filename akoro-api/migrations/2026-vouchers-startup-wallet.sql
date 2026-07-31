-- =============================================================
-- 2026-vouchers-startup-wallet.sql
-- Startup settlement ledger + withdrawals. Pays startups based on ACTUAL
-- REDEEMED credits (not codes sold to an agent) — the safer model: a startup
-- earns nothing until a real end-customer redeems, so nobody can be paid for
-- vouchers that are never used.
--
-- Still fully self-contained in the `vouchers` schema (see 2026-vouchers-
-- module.sql for the decoupling rationale).
-- =============================================================

-- Snapshot what the agent actually paid for THIS code at purchase time, so
-- settlement is correct even if the startup's rate changes later.
ALTER TABLE vouchers.codes ADD COLUMN IF NOT EXISTS paid_price_usd NUMERIC(12,6);

CREATE TABLE IF NOT EXISTS vouchers.startup_wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id  UUID NOT NULL UNIQUE REFERENCES vouchers.startups(id) ON DELETE CASCADE,
  balance_usd NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance_usd >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vouchers.startup_wallet_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id      UUID NOT NULL REFERENCES vouchers.startup_wallets(id) ON DELETE CASCADE,
  delta_usd      NUMERIC(14,2) NOT NULL,
  balance_after  NUMERIC(14,2) NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('redemption_credit','withdrawal','refund','adjust')),
  ref            TEXT,                        -- code id (credit) / withdrawal id (debit)
  meta           JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vouchers_startup_wallet_tx ON vouchers.startup_wallet_transactions (wallet_id, created_at DESC);
-- A given code can only ever credit the startup wallet once (redeem_code()
-- itself is the primary guard; this is belt-and-suspenders at the ledger).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_startup_credit_ref
  ON vouchers.startup_wallet_transactions (wallet_id, ref) WHERE type = 'redemption_credit';

CREATE TABLE IF NOT EXISTS vouchers.withdrawals (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id              UUID NOT NULL REFERENCES vouchers.startups(id) ON DELETE CASCADE,
  wallet_id               UUID NOT NULL REFERENCES vouchers.startup_wallets(id) ON DELETE CASCADE,
  amount_usd              NUMERIC(14,2) NOT NULL CHECK (amount_usd > 0),
  bank_code               TEXT NOT NULL,
  account_number          TEXT NOT NULL,
  account_name            TEXT,
  paystack_recipient_code TEXT,
  paystack_transfer_code  TEXT,
  status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','failed')),
  failure_reason          TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at                 TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vouchers_withdrawals_startup ON vouchers.withdrawals (startup_id, created_at DESC);

-- ── Atomic ops (same pattern as the agent wallet) ──────────────────────────────
CREATE OR REPLACE FUNCTION vouchers.startup_wallet_credit(p_wallet UUID, p_amount NUMERIC, p_type TEXT, p_ref TEXT, p_meta JSONB DEFAULT '{}')
RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE v_new NUMERIC;
BEGIN
  IF p_type = 'redemption_credit' AND p_ref IS NOT NULL THEN
    BEGIN
      INSERT INTO vouchers.startup_wallet_transactions (wallet_id, delta_usd, balance_after, type, ref, meta)
        VALUES (p_wallet, p_amount, -1, p_type, p_ref, p_meta);
    EXCEPTION WHEN unique_violation THEN
      RETURN NULL;   -- already credited for this code (idempotent)
    END;
    UPDATE vouchers.startup_wallets SET balance_usd = balance_usd + p_amount, updated_at = now()
      WHERE id = p_wallet RETURNING balance_usd INTO v_new;
    UPDATE vouchers.startup_wallet_transactions SET balance_after = v_new WHERE type = 'redemption_credit' AND ref = p_ref AND wallet_id = p_wallet;
    RETURN v_new;
  END IF;
  UPDATE vouchers.startup_wallets SET balance_usd = balance_usd + p_amount, updated_at = now()
    WHERE id = p_wallet RETURNING balance_usd INTO v_new;
  INSERT INTO vouchers.startup_wallet_transactions (wallet_id, delta_usd, balance_after, type, ref, meta)
    VALUES (p_wallet, p_amount, v_new, p_type, p_ref, p_meta);
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION vouchers.startup_wallet_debit(p_wallet UUID, p_amount NUMERIC, p_type TEXT, p_ref TEXT, p_meta JSONB DEFAULT '{}')
RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE v_new NUMERIC;
BEGIN
  UPDATE vouchers.startup_wallets SET balance_usd = balance_usd - p_amount, updated_at = now()
    WHERE id = p_wallet AND balance_usd >= p_amount
    RETURNING balance_usd INTO v_new;
  IF v_new IS NULL THEN RETURN NULL; END IF;
  INSERT INTO vouchers.startup_wallet_transactions (wallet_id, delta_usd, balance_after, type, ref, meta)
    VALUES (p_wallet, -p_amount, v_new, p_type, p_ref, p_meta);
  RETURN v_new;
END $$;

-- New tables since the module's initial grant — cover them explicitly too
-- (belt-and-suspenders alongside the ALTER DEFAULT PRIVILEGES in the base migration).
GRANT ALL ON ALL TABLES    IN SCHEMA vouchers TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vouchers TO service_role;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
