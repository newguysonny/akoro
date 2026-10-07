-- =============================================================
-- 2026-seed-voucher-demo.sql
-- Demo seed for the Voucher-as-a-Service module (akoro-agent / akoro-business):
--   1 startup  — "Akoro" itself (owner: business-demo@demo.akoro.app)
--   1 API key  — raw key printed via RAISE NOTICE (shown once, like real issuance)
--   1 agent    — agent-demo@demo.akoro.app
--   1 batch    — agent buys 10 vouchers @ ₦1,000 each (₦10,000 total)
--   10 codes   — active, ready to redeem via POST /api/vouchers/v1/validate
--
-- ₦1,000 → USD conversion uses a fixed demo rate of ₦1,500/$1 (~$0.667/voucher,
-- ~$6.67 total) purely so the seeded USD ledger numbers are realistic — adjust
-- FX_RATE below if you want a different snapshot.
--
-- All seeded accounts log in with password: Password123!
-- Idempotent — guarded by email/slug; safe to re-run.
-- =============================================================

DO $$
DECLARE
  v_pw          text := '$2b$10$HKzqNJTCBHeB0uWSWhf7PeLIOMrlEw2.9oYDI3vQPEs6WAl5Fo7KS'; -- Password123!
  v_owner       uuid;
  v_agent       uuid;
  v_startup     uuid;
  v_agent_wallet   uuid;
  v_startup_wallet uuid;
  v_batch       uuid;
  v_raw_key     text;
  v_key_prefix  text;
  v_code        text;
  i             int;

  FX_RATE       numeric := 1500;              -- ₦ per $1 (demo snapshot)
  UNIT_NAIRA    numeric := 1000;               -- ₦ per voucher
  QTY           int     := 10;
  UNIT_USD      numeric := round(UNIT_NAIRA / FX_RATE, 6);   -- ≈ 0.666667
  TOTAL_USD     numeric := round(UNIT_NAIRA * QTY / FX_RATE, 2); -- ≈ 6.67
BEGIN
  -- ── Startup owner (Akoro, as its own first startup) ────────────────────
  SELECT id INTO v_owner FROM public.users WHERE email = 'business-demo@demo.akoro.app';
  IF v_owner IS NULL THEN
    INSERT INTO public.users (email, username, password_hash, full_name, role, is_active)
    VALUES ('business-demo@demo.akoro.app', 'akoro_business_demo', v_pw, 'Akoro Business Demo', 'student', true)
    RETURNING id INTO v_owner;
  END IF;

  -- ── Agent ────────────────────────────────────────────────────────────
  SELECT id INTO v_agent FROM public.users WHERE email = 'agent-demo@demo.akoro.app';
  IF v_agent IS NULL THEN
    INSERT INTO public.users (email, username, password_hash, full_name, role, is_active)
    VALUES ('agent-demo@demo.akoro.app', 'akoro_agent_demo', v_pw, 'Akoro Agent Demo', 'student', true)
    RETURNING id INTO v_agent;
  END IF;

  -- ── Startup: "Akoro" ────────────────────────────────────────────────
  SELECT id INTO v_startup FROM vouchers.startups WHERE slug = 'akoro';
  IF v_startup IS NULL THEN
    INSERT INTO vouchers.startups (owner_user_id, name, slug, credit_rate_usd, status)
    VALUES (v_owner, 'Akoro', 'akoro', UNIT_USD, 'active')
    RETURNING id INTO v_startup;
  END IF;

  -- ── API key (only issued once — skip if this startup already has one) ──
  IF NOT EXISTS (SELECT 1 FROM vouchers.api_keys WHERE startup_id = v_startup) THEN
    v_raw_key := 'sk_live_demo_' || encode(gen_random_bytes(18), 'base64');
    v_raw_key := replace(replace(replace(v_raw_key, '/', '_'), '+', '-'), '=', '');
    v_key_prefix := left(v_raw_key, 14) || '…';
    INSERT INTO vouchers.api_keys (startup_id, key_prefix, key_hash, label)
    VALUES (v_startup, v_key_prefix, encode(digest(v_raw_key, 'sha256'), 'hex'), 'Demo seed key');
    RAISE NOTICE 'Voucher demo API key (shown once): %', v_raw_key;
  END IF;

  -- ── Agent wallet: top up then spend the exact batch cost ───────────────
  SELECT id INTO v_agent_wallet FROM vouchers.agent_wallets WHERE user_id = v_agent;
  IF v_agent_wallet IS NULL THEN
    INSERT INTO vouchers.agent_wallets (user_id, balance_usd) VALUES (v_agent, 0)
    RETURNING id INTO v_agent_wallet;
  END IF;

  -- ── Startup wallet (settlement balance — starts empty; nothing redeemed yet)
  SELECT id INTO v_startup_wallet FROM vouchers.startup_wallets WHERE startup_id = v_startup;
  IF v_startup_wallet IS NULL THEN
    INSERT INTO vouchers.startup_wallets (startup_id, balance_usd) VALUES (v_startup, 0)
    RETURNING id INTO v_startup_wallet;
  END IF;

  -- ── The purchase: only run once (idempotent on a marker batch) ─────────
  IF NOT EXISTS (SELECT 1 FROM vouchers.batches WHERE startup_id = v_startup AND agent_id = v_agent) THEN
    PERFORM vouchers.wallet_credit(v_agent_wallet, TOTAL_USD, 'topup', 'seed-voucher-demo-topup', '{"note":"demo seed"}');
    PERFORM vouchers.wallet_debit(v_agent_wallet, TOTAL_USD, 'purchase', 'seed-voucher-demo-purchase', '{"note":"demo seed"}');

    INSERT INTO vouchers.batches (startup_id, agent_id, quantity, unit_credits, unit_price_usd, total_cost_usd, status)
    VALUES (v_startup, v_agent, QTY, 1, UNIT_USD, TOTAL_USD, 'paid')
    RETURNING id INTO v_batch;

    FOR i IN 1..QTY LOOP
      v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4)) || '-' ||
                upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4)) || '-' ||
                upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4));
      INSERT INTO vouchers.codes (code, batch_id, startup_id, agent_id, credits, status, paid_price_usd)
      VALUES (v_code, v_batch, v_startup, v_agent, 1, 'active', UNIT_USD);
    END LOOP;

    RAISE NOTICE 'Seeded % vouchers (₦% each, ₦% total ≈ $%) for agent-demo@demo.akoro.app against startup "Akoro"', QTY, UNIT_NAIRA, UNIT_NAIRA * QTY, TOTAL_USD;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
