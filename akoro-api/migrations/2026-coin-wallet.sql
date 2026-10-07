-- =============================================================
-- 2026-coin-wallet.sql
-- Coin wallet: one balance per account (a user OR a school), an append-only
-- ledger, and ATOMIC credit/debit/topup functions so concurrent AI charges and
-- webhook top-ups can never double-spend or double-credit. Idempotent DDL.
--
-- Economics live in the API (lib/aiPricing.js): 1 coin ≈ a fixed money value,
-- AI calls debit coins = real token cost × markup. This layer only moves
-- integer coins and records why.
-- =============================================================
CREATE TABLE IF NOT EXISTS public.coin_accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type  text NOT NULL CHECK (owner_type IN ('user','school')),
  owner_id    uuid NOT NULL,                      -- users.id or school_profiles.id
  balance     bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_type, owner_id)
);
CREATE INDEX IF NOT EXISTS idx_coin_accounts_owner ON public.coin_accounts (owner_type, owner_id);

CREATE TABLE IF NOT EXISTS public.coin_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES public.coin_accounts(id) ON DELETE CASCADE,
  delta          bigint NOT NULL,                 -- +credit / -debit (in coins)
  balance_after  bigint NOT NULL,
  type           text NOT NULL CHECK (type IN ('topup','debit','grant','allocate','refund','adjust')),
  feature        text,                            -- AI feature that spent (for debits)
  model          text,
  tokens_in      integer,
  tokens_out     integer,
  cost_usd       numeric(12,6),                   -- underlying real cost (audit)
  ref            text,                            -- paystack ref / task id / idempotency key
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coin_tx_account ON public.coin_transactions (account_id, created_at DESC);
-- Idempotency: a given top-up reference credits exactly once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_coin_tx_topup_ref
  ON public.coin_transactions (ref) WHERE type = 'topup' AND ref IS NOT NULL;

-- ── Atomic credit (top-ups handled separately for idempotency) ────────────────
CREATE OR REPLACE FUNCTION public.coin_credit(p_account uuid, p_amount bigint, p_type text, p_meta jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_new bigint;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'credit amount must be positive'; END IF;
  UPDATE public.coin_accounts SET balance = balance + p_amount, updated_at = now()
    WHERE id = p_account RETURNING balance INTO v_new;
  IF v_new IS NULL THEN RETURN NULL; END IF;   -- no such account
  INSERT INTO public.coin_transactions(account_id, delta, balance_after, type, ref, feature, cost_usd, created_by)
    VALUES (p_account, p_amount, v_new, p_type, p_meta->>'ref', p_meta->>'feature', (p_meta->>'cost')::numeric, (p_meta->>'by')::uuid);
  RETURN v_new;
END $$;

-- ── Atomic debit — single conditional UPDATE prevents overdraft + races ────────
-- Returns the new balance, or NULL if the balance is insufficient (no ledger row
-- is written in that case, so callers can hard-block cleanly).
CREATE OR REPLACE FUNCTION public.coin_debit(p_account uuid, p_amount bigint, p_type text, p_meta jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_new bigint;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'debit amount must be positive'; END IF;
  UPDATE public.coin_accounts SET balance = balance - p_amount, updated_at = now()
    WHERE id = p_account AND balance >= p_amount RETURNING balance INTO v_new;
  IF v_new IS NULL THEN RETURN NULL; END IF;   -- insufficient (or no account)
  INSERT INTO public.coin_transactions(account_id, delta, balance_after, type, feature, model, tokens_in, tokens_out, cost_usd, ref, created_by)
    VALUES (p_account, -p_amount, v_new, p_type, p_meta->>'feature', p_meta->>'model',
            (p_meta->>'tokens_in')::int, (p_meta->>'tokens_out')::int, (p_meta->>'cost')::numeric, p_meta->>'ref', (p_meta->>'by')::uuid);
  RETURN v_new;
END $$;

-- ── Idempotent top-up — credits a reference exactly once ──────────────────────
CREATE OR REPLACE FUNCTION public.coin_topup(p_account uuid, p_amount bigint, p_ref text, p_meta jsonb)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_new bigint;
BEGIN
  IF p_amount <= 0 THEN RAISE EXCEPTION 'topup amount must be positive'; END IF;
  -- Reserve the reference first; a duplicate ref means it was already credited.
  BEGIN
    INSERT INTO public.coin_transactions(account_id, delta, balance_after, type, ref, cost_usd, created_by)
      VALUES (p_account, p_amount, -1, 'topup', p_ref, (p_meta->>'cost')::numeric, (p_meta->>'by')::uuid);
  EXCEPTION WHEN unique_violation THEN
    RETURN NULL;   -- already credited (idempotent replay)
  END;
  UPDATE public.coin_accounts SET balance = balance + p_amount, updated_at = now()
    WHERE id = p_account RETURNING balance INTO v_new;
  UPDATE public.coin_transactions SET balance_after = v_new
    WHERE type = 'topup' AND ref = p_ref;
  RETURN v_new;
END $$;

NOTIFY pgrst, 'reload schema';
