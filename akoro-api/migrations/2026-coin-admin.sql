-- =============================================================
-- 2026-coin-admin.sql
-- Platform-wide coin analytics for the admin wallet dashboard. Read-only
-- aggregate over coin_accounts / coin_transactions. Idempotent.
-- =============================================================
CREATE OR REPLACE FUNCTION public.coin_overview()
RETURNS json LANGUAGE sql STABLE AS $$
  SELECT json_build_object(
    'accounts',        (SELECT count(*)                 FROM public.coin_accounts),
    'total_balance',   (SELECT coalesce(sum(balance),0) FROM public.coin_accounts),
    'total_topped_up', (SELECT coalesce(sum(delta),0)   FROM public.coin_transactions WHERE type = 'topup'),
    'total_granted',   (SELECT coalesce(sum(delta),0)   FROM public.coin_transactions WHERE type IN ('grant','allocate') AND delta > 0),
    'total_spent',     (SELECT coalesce(-sum(delta),0)  FROM public.coin_transactions WHERE type = 'debit'),
    'topups_7d',       (SELECT coalesce(sum(delta),0)   FROM public.coin_transactions WHERE type = 'topup' AND created_at > now() - interval '7 days'),
    'spent_7d',        (SELECT coalesce(-sum(delta),0)  FROM public.coin_transactions WHERE type = 'debit' AND created_at > now() - interval '7 days'),
    'spend_by_feature',(SELECT coalesce(json_agg(f), '[]'::json) FROM (
        SELECT feature, -sum(delta) AS coins, count(*) AS calls
        FROM public.coin_transactions
        WHERE type = 'debit' AND feature IS NOT NULL
        GROUP BY feature ORDER BY -sum(delta) DESC LIMIT 20) f)
  );
$$;

NOTIFY pgrst, 'reload schema';
