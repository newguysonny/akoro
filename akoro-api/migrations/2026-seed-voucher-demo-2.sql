-- =============================================================
-- 2026-seed-voucher-demo-2.sql
-- Enrichment on top of 2026-seed-voucher-demo.sql — makes every voucher
-- dashboard show real data instead of empty states:
--   1. Discount tiers on "Akoro" (50→5%, 100→10%)
--   2. 3 of the 10 seeded codes get REDEEMED (populates redemptions,
--      startup settlement wallet, and dashboard analytics)
--   3. 2 withdrawal records on the startup wallet (1 paid, 1 pending)
--   4. A second batch for the same agent (5 more vouchers, different day)
--   5. A second startup "EduPay" in the marketplace, with its own tier
--
-- Depends on 2026-seed-voucher-demo.sql having already run. Idempotent —
-- guarded by existing rows; safe to re-run.
-- =============================================================

DO $$
DECLARE
  v_owner           uuid;
  v_agent           uuid;
  v_startup         uuid;
  v_startup_wallet  uuid;
  v_agent_wallet    uuid;
  v_edupay          uuid;
  v_edupay_owner    uuid;
  v_batch2          uuid;
  v_code            RECORD;
  v_code_text       text;
  v_credit_amount   numeric;
  v_customer_n      int := 0;
  i                 int;
  PLATFORM_FEE_PCT  numeric := 10;   -- mirrors lib/startupWallet.js default

  FX_RATE           numeric := 1500;
  UNIT_NAIRA2       numeric := 1500;
  QTY2              int     := 5;
  UNIT_USD2         numeric := round(UNIT_NAIRA2 / FX_RATE, 6);
  TOTAL_USD2        numeric := round(UNIT_NAIRA2 * QTY2 / FX_RATE, 2);
BEGIN
  SELECT id INTO v_owner FROM public.users WHERE email = 'business-demo@demo.akoro.app';
  SELECT id INTO v_agent FROM public.users WHERE email = 'agent-demo@demo.akoro.app';
  SELECT id INTO v_startup FROM vouchers.startups WHERE slug = 'akoro';
  SELECT id INTO v_startup_wallet FROM vouchers.startup_wallets WHERE startup_id = v_startup;
  SELECT id INTO v_agent_wallet FROM vouchers.agent_wallets WHERE user_id = v_agent;

  IF v_startup IS NULL OR v_agent IS NULL THEN
    RAISE NOTICE 'Base voucher demo seed not found — run 2026-seed-voucher-demo.sql first. Skipping.';
    RETURN;
  END IF;

  -- ── 1. Discount tiers on Akoro ──────────────────────────────────────────
  INSERT INTO vouchers.discount_tiers (startup_id, min_credits, discount_pct, sort_order)
  VALUES (v_startup, 50, 5, 1)
  ON CONFLICT (startup_id, min_credits) DO NOTHING;
  INSERT INTO vouchers.discount_tiers (startup_id, min_credits, discount_pct, sort_order)
  VALUES (v_startup, 100, 10, 2)
  ON CONFLICT (startup_id, min_credits) DO NOTHING;

  -- ── 2. Redeem 3 of the seeded codes ─────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM vouchers.redemptions WHERE startup_id = v_startup) THEN
    FOR v_code IN
      SELECT code, id, paid_price_usd FROM vouchers.codes
      WHERE startup_id = v_startup AND status = 'active'
      ORDER BY created_at ASC LIMIT 3
    LOOP
      v_customer_n := v_customer_n + 1;
      v_code_text := v_code.code;

      -- Atomic redeem (same primitive the real /v1/validate call uses).
      PERFORM * FROM vouchers.redeem_code(v_code_text, v_startup, 'cust_demo_' || v_customer_n, 'seed-redeem-' || v_customer_n);

      INSERT INTO vouchers.redemptions (code_id, startup_id, customer_id, idempotency_key)
      VALUES (v_code.id, v_startup, 'cust_demo_' || v_customer_n, 'seed-redeem-' || v_customer_n);

      v_credit_amount := round(coalesce(v_code.paid_price_usd, 0) * (1 - PLATFORM_FEE_PCT / 100), 2);
      IF v_credit_amount > 0 THEN
        PERFORM vouchers.startup_wallet_credit(v_startup_wallet, v_credit_amount, 'redemption_credit', v_code.id::text, '{"note":"demo seed"}');
      END IF;
    END LOOP;
    RAISE NOTICE 'Redeemed % demo codes for startup "Akoro"', v_customer_n;
  END IF;

  -- ── 3. Withdrawal history on the startup wallet ─────────────────────────
  IF NOT EXISTS (SELECT 1 FROM vouchers.withdrawals WHERE startup_id = v_startup) THEN
    INSERT INTO vouchers.withdrawals (startup_id, wallet_id, amount_usd, bank_code, account_number, account_name, status, paid_at)
    VALUES (v_startup, v_startup_wallet, 1.00, '044', '0123456789', 'Akoro Ltd', 'paid', now() - interval '2 days');

    INSERT INTO vouchers.withdrawals (startup_id, wallet_id, amount_usd, bank_code, account_number, account_name, status)
    VALUES (v_startup, v_startup_wallet, 0.50, '044', '0123456789', 'Akoro Ltd', 'pending');
  END IF;

  -- ── 4. A second batch for the same agent (purchase history) ────────────
  IF (SELECT count(*) FROM vouchers.batches WHERE startup_id = v_startup AND agent_id = v_agent) < 2 THEN
    PERFORM vouchers.wallet_credit(v_agent_wallet, TOTAL_USD2, 'topup', 'seed-voucher-demo-topup-2', '{"note":"demo seed batch 2"}');
    PERFORM vouchers.wallet_debit(v_agent_wallet, TOTAL_USD2, 'purchase', 'seed-voucher-demo-purchase-2', '{"note":"demo seed batch 2"}');

    INSERT INTO vouchers.batches (startup_id, agent_id, quantity, unit_credits, unit_price_usd, total_cost_usd, status, created_at)
    VALUES (v_startup, v_agent, QTY2, 1, UNIT_USD2, TOTAL_USD2, 'paid', now() - interval '1 day')
    RETURNING id INTO v_batch2;

    FOR i IN 1..QTY2 LOOP
      v_code_text := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4)) || '-' ||
                     upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4)) || '-' ||
                     upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4));
      INSERT INTO vouchers.codes (code, batch_id, startup_id, agent_id, credits, status, paid_price_usd, created_at)
      VALUES (v_code_text, v_batch2, v_startup, v_agent, 1, 'active', UNIT_USD2, now() - interval '1 day');
    END LOOP;

    RAISE NOTICE 'Seeded a second batch of % vouchers for agent-demo@demo.akoro.app', QTY2;
  END IF;

  -- ── 5. A second startup: "EduPay" ───────────────────────────────────────
  SELECT id INTO v_edupay_owner FROM public.users WHERE email = 'edupay-demo@demo.akoro.app';
  IF v_edupay_owner IS NULL THEN
    INSERT INTO public.users (email, username, password_hash, full_name, role, is_active)
    SELECT 'edupay-demo@demo.akoro.app', 'edupay_demo', password_hash, 'EduPay Demo', 'student', true
    FROM public.users WHERE email = 'business-demo@demo.akoro.app'
    RETURNING id INTO v_edupay_owner;
  END IF;

  SELECT id INTO v_edupay FROM vouchers.startups WHERE slug = 'edupay';
  IF v_edupay IS NULL THEN
    INSERT INTO vouchers.startups (owner_user_id, name, slug, credit_rate_usd, status)
    VALUES (v_edupay_owner, 'EduPay', 'edupay', 0.5, 'active')
    RETURNING id INTO v_edupay;

    INSERT INTO vouchers.discount_tiers (startup_id, min_credits, discount_pct, sort_order)
    VALUES (v_edupay, 20, 8, 1)
    ON CONFLICT (startup_id, min_credits) DO NOTHING;

    INSERT INTO vouchers.startup_wallets (startup_id, balance_usd) VALUES (v_edupay, 0)
    ON CONFLICT (startup_id) DO NOTHING;

    RAISE NOTICE 'Seeded second marketplace startup "EduPay"';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
