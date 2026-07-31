-- =============================================================
-- 2026-vouchers-module.sql
-- "Voucher-as-a-Service" — B2B prepaid credit vouchers for third-party apps.
--
-- SELF-CONTAINED BY DESIGN: everything lives in its own `vouchers` postgres
-- schema and references NOTHING outside it except public.users(id) (the
-- Akoro identity an agent/startup-owner logs in with) — a single FK you can
-- drop and replace with any other user table if this module is ever split
-- into its own service. No FKs to edu.*/mgmt.* schemas, no shared tables.
--
-- Ledger pattern mirrors the coin wallet (2026-coin-wallet.sql) — atomic
-- conditional-UPDATE debit/credit — but is a SEPARATE ledger. Do not import
-- lib/coins.js from this module; keep the two systems decoupled.
-- =============================================================
CREATE SCHEMA IF NOT EXISTS vouchers;

-- Expose + grants (self-hosted PostgREST path — same pattern as `mgmt`/`edu`).
-- Without this, db.schema("vouchers") calls fail with PGRST106/"Invalid
-- schema: vouchers" even though the schema and tables exist — PostgREST only
-- serves schemas listed here, and the API role needs explicit grants.
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, content, edu, mgmt, vouchers, storage, graphql_public';
GRANT USAGE ON SCHEMA vouchers TO authenticator, service_role, anon, authenticated;
GRANT ALL ON ALL TABLES    IN SCHEMA vouchers TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vouchers TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA vouchers GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA vouchers GRANT ALL ON SEQUENCES TO service_role;

-- ── Startups (the businesses selling credit through agents) ───────────────────
CREATE TABLE IF NOT EXISTS vouchers.startups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  credit_rate_usd NUMERIC(12,6) NOT NULL CHECK (credit_rate_usd > 0),  -- $ per 1 credit, startup's own rate
  webhook_url     TEXT,
  webhook_secret  TEXT,                       -- HMAC signing secret for outbound webhooks
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vouchers_startups_owner ON vouchers.startups (owner_user_id);

-- ── Bulk-purchase discount tiers (gamified: bigger packages, steeper discount) ─
CREATE TABLE IF NOT EXISTS vouchers.discount_tiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id    UUID NOT NULL REFERENCES vouchers.startups(id) ON DELETE CASCADE,
  min_credits   INTEGER NOT NULL CHECK (min_credits > 0),
  discount_pct  NUMERIC(5,2) NOT NULL CHECK (discount_pct >= 0 AND discount_pct < 100),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (startup_id, min_credits)
);

-- ── API keys — how a startup's OWN backend calls the validate endpoint ────────
-- The raw key is shown to the startup ONCE at creation; only its hash is
-- stored. key_prefix is kept in the clear so the UI can show "sk_live_ab12…"
-- without ever re-displaying the secret.
CREATE TABLE IF NOT EXISTS vouchers.api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id    UUID NOT NULL REFERENCES vouchers.startups(id) ON DELETE CASCADE,
  key_prefix    TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,          -- sha256(raw key)
  label         TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vouchers_api_keys_startup ON vouchers.api_keys (startup_id);

-- ── Agent wallets — a SEPARATE ledger from the Akoro coin wallet ──────────────
CREATE TABLE IF NOT EXISTS vouchers.agent_wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  balance_usd NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance_usd >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vouchers.agent_wallet_transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id      UUID NOT NULL REFERENCES vouchers.agent_wallets(id) ON DELETE CASCADE,
  delta_usd      NUMERIC(14,2) NOT NULL,       -- +credit / -debit
  balance_after  NUMERIC(14,2) NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('topup','purchase','refund','adjust')),
  ref            TEXT,                         -- paystack ref / batch id / idempotency key
  meta           JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vouchers_wallet_tx_wallet ON vouchers.agent_wallet_transactions (wallet_id, created_at DESC);
-- Idempotent top-up: a given Paystack reference credits exactly once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_wallet_topup_ref
  ON vouchers.agent_wallet_transactions (ref) WHERE type = 'topup' AND ref IS NOT NULL;

-- ── Batches — one purchase event (agent buys N codes from a startup) ──────────
CREATE TABLE IF NOT EXISTS vouchers.batches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id       UUID NOT NULL REFERENCES vouchers.startups(id) ON DELETE CASCADE,
  agent_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_credits     INTEGER NOT NULL CHECK (unit_credits > 0),
  unit_price_usd   NUMERIC(12,6) NOT NULL,     -- after any discount tier
  total_cost_usd   NUMERIC(14,2) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','paid','failed','refunded')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vouchers_batches_agent   ON vouchers.batches (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vouchers_batches_startup ON vouchers.batches (startup_id, created_at DESC);

-- ── Codes — the actual redeemable vouchers ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS vouchers.codes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 TEXT NOT NULL UNIQUE,     -- e.g. X9K7-MQPL-3R9T
  batch_id             UUID NOT NULL REFERENCES vouchers.batches(id) ON DELETE CASCADE,
  startup_id           UUID NOT NULL REFERENCES vouchers.startups(id) ON DELETE CASCADE,  -- denormalised for O(1) validate lookups
  agent_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  credits              INTEGER NOT NULL CHECK (credits > 0),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','used','expired','refunded')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ,
  used_at              TIMESTAMPTZ,
  used_by_customer_id  TEXT,
  redeem_idempotency_key TEXT                    -- the key the startup sent, for replay-safety
);
CREATE INDEX IF NOT EXISTS idx_vouchers_codes_batch   ON vouchers.codes (batch_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_codes_agent   ON vouchers.codes (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vouchers_codes_startup ON vouchers.codes (startup_id, status);

-- ── Redemption audit trail (every validate call that actually redeemed) ───────
CREATE TABLE IF NOT EXISTS vouchers.redemptions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id        UUID NOT NULL REFERENCES vouchers.codes(id) ON DELETE CASCADE,
  startup_id     UUID NOT NULL REFERENCES vouchers.startups(id) ON DELETE CASCADE,
  customer_id    TEXT,
  idempotency_key TEXT,
  ip_address     INET,
  user_agent     TEXT,
  redeemed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vouchers_redemptions_startup ON vouchers.redemptions (startup_id, redeemed_at DESC);
-- One redemption row per (startup, idempotency_key) when the startup sends one —
-- makes a retried validate call from the startup's side a safe no-op.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vouchers_redemption_idem
  ON vouchers.redemptions (startup_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ── Settlements (what you owe each startup for credits actually redeemed) ─────
CREATE TABLE IF NOT EXISTS vouchers.settlements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  startup_id               UUID NOT NULL REFERENCES vouchers.startups(id) ON DELETE CASCADE,
  period_start             DATE NOT NULL,
  period_end               DATE NOT NULL,
  total_credits_redeemed   BIGINT NOT NULL DEFAULT 0,
  amount_due_usd           NUMERIC(14,2) NOT NULL DEFAULT 0,
  status                   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at                  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vouchers_settlements_startup ON vouchers.settlements (startup_id, period_start DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- ATOMIC OPERATIONS — every balance/state change is a single conditional
-- UPDATE so concurrent requests can never double-spend or double-redeem.
-- ═══════════════════════════════════════════════════════════════════════════

-- Debit the agent wallet (purchase). Returns new balance, or NULL if the
-- wallet doesn't have enough (caller hard-blocks on NULL — no overdraft).
CREATE OR REPLACE FUNCTION vouchers.wallet_debit(p_wallet UUID, p_amount NUMERIC, p_type TEXT, p_ref TEXT, p_meta JSONB DEFAULT '{}')
RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE v_new NUMERIC;
BEGIN
  UPDATE vouchers.agent_wallets SET balance_usd = balance_usd - p_amount, updated_at = now()
    WHERE id = p_wallet AND balance_usd >= p_amount
    RETURNING balance_usd INTO v_new;
  IF v_new IS NULL THEN RETURN NULL; END IF;
  INSERT INTO vouchers.agent_wallet_transactions (wallet_id, delta_usd, balance_after, type, ref, meta)
    VALUES (p_wallet, -p_amount, v_new, p_type, p_ref, p_meta);
  RETURN v_new;
END $$;

-- Credit the agent wallet (top-up / refund). Idempotent on p_ref for topups —
-- a duplicate webhook delivery credits exactly once.
CREATE OR REPLACE FUNCTION vouchers.wallet_credit(p_wallet UUID, p_amount NUMERIC, p_type TEXT, p_ref TEXT, p_meta JSONB DEFAULT '{}')
RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE v_new NUMERIC;
BEGIN
  IF p_type = 'topup' AND p_ref IS NOT NULL THEN
    BEGIN
      INSERT INTO vouchers.agent_wallet_transactions (wallet_id, delta_usd, balance_after, type, ref, meta)
        VALUES (p_wallet, p_amount, -1, p_type, p_ref, p_meta);
    EXCEPTION WHEN unique_violation THEN
      RETURN NULL;   -- already credited (idempotent replay)
    END;
    UPDATE vouchers.agent_wallets SET balance_usd = balance_usd + p_amount, updated_at = now()
      WHERE id = p_wallet RETURNING balance_usd INTO v_new;
    UPDATE vouchers.agent_wallet_transactions SET balance_after = v_new WHERE type = 'topup' AND ref = p_ref;
    RETURN v_new;
  END IF;
  UPDATE vouchers.agent_wallets SET balance_usd = balance_usd + p_amount, updated_at = now()
    WHERE id = p_wallet RETURNING balance_usd INTO v_new;
  INSERT INTO vouchers.agent_wallet_transactions (wallet_id, delta_usd, balance_after, type, ref, meta)
    VALUES (p_wallet, p_amount, v_new, p_type, p_ref, p_meta);
  RETURN v_new;
END $$;

-- THE core anti-fraud primitive: redeem a code atomically. A single
-- conditional UPDATE means two simultaneous validate calls for the same code
-- can never both succeed — exactly what stops double-spend across startups
-- or concurrent retries.
CREATE OR REPLACE FUNCTION vouchers.redeem_code(p_code TEXT, p_startup_id UUID, p_customer_id TEXT, p_idempotency_key TEXT DEFAULT NULL)
RETURNS TABLE(id UUID, credits INTEGER, already_used BOOLEAN) LANGUAGE plpgsql AS $$
DECLARE v_row vouchers.codes%ROWTYPE;
BEGIN
  UPDATE vouchers.codes SET status = 'used', used_at = now(), used_by_customer_id = p_customer_id,
         redeem_idempotency_key = p_idempotency_key
    WHERE code = p_code AND startup_id = p_startup_id AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
    RETURNING * INTO v_row;
  IF FOUND THEN
    RETURN QUERY SELECT v_row.id, v_row.credits, false;
    RETURN;
  END IF;
  RETURN;   -- no row → caller checks WHY (not found / already used / expired) separately
END $$;

-- Cover tables created by this migration (ALTER DEFAULT PRIVILEGES above only
-- applies to tables created AFTER it ran, i.e. from here on — these came first).
GRANT ALL ON ALL TABLES    IN SCHEMA vouchers TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA vouchers TO service_role;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
