-- =============================================================
-- 2026-coin-welcome-grant-heal.sql
-- Fund the wallets that a bug left empty.
--
-- ensureAccount() creates a coin account and then credits the welcome grant —
-- but it did that with `db.rpc(...).catch(() => {})`, and a Supabase builder is
-- a thenable with NO .catch method. So the call threw TypeError synchronously,
-- the request 500'd, and the account row was left behind at zero.
--
-- The damage outlives the code fix: ensureAccount only grants at CREATION, so
-- every user who touched an AI feature before the fix now owns a wallet that
-- will never be funded. Their first AI action fails with "Insufficient coin
-- balance" forever, which reads as a billing problem rather than a bug.
--
-- So: credit the welcome grant to any account that has never received one.
-- Idempotent by the absence of a 'grant' transaction, not by balance — a user
-- who was granted and then spent it all must not be granted again.
--
-- The amount matches lib/aiPricing.js's default (COIN_WELCOME_GRANT, 200). If
-- that env var is set to something else in your environment, this backfill uses
-- 200 regardless; adjust below before deploying if that matters to you.
-- =============================================================

DO $$
DECLARE
  v_grant   bigint := 200;
  v_healed  int    := 0;
  r         record;
BEGIN
  FOR r IN
    SELECT a.id, a.balance
    FROM public.coin_accounts a
    WHERE NOT EXISTS (
      SELECT 1 FROM public.coin_transactions t
      WHERE t.account_id = a.id AND t.type = 'grant'
    )
  LOOP
    INSERT INTO public.coin_transactions (account_id, delta, balance_after, type, feature)
    VALUES (r.id, v_grant, r.balance + v_grant, 'grant', 'welcome_grant_backfill');

    UPDATE public.coin_accounts
       SET balance = balance + v_grant, updated_at = now()
     WHERE id = r.id;

    v_healed := v_healed + 1;
  END LOOP;

  IF v_healed > 0 THEN
    RAISE NOTICE 'coins: welcome grant backfilled to % account(s)', v_healed;
  END IF;
END $$;

-- Verify:
--   SELECT count(*) FILTER (WHERE t.id IS NULL) AS still_ungranted
--   FROM public.coin_accounts a
--   LEFT JOIN public.coin_transactions t ON t.account_id = a.id AND t.type = 'grant';
