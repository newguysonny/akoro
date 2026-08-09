-- =============================================================
-- 2026-ai-spend-reporting.sql
-- The aggregates behind the AI spend dashboard.
--
-- These are SQL functions rather than queries in the API for one reason:
-- percentiles. p95 latency over a day of calls must not mean shipping a day of
-- calls into the Node process to sort them — and PostgREST cannot express
-- percentile_disc with a GROUP BY through its REST grammar at all.
--
-- Each returns a small, bounded result whatever the window contains.
--
-- Idempotent: CREATE OR REPLACE throughout.
-- =============================================================

-- ── Where the money goes ─────────────────────────────────────────────────
-- p95 sits next to cost on purpose: it is the pair that decides whether a
-- feature is a candidate for a cheaper model. Expensive and fast, yes.
-- Expensive and already slow, no.
CREATE OR REPLACE FUNCTION edu.ai_spend_by_feature(p_hours int DEFAULT 24)
RETURNS TABLE (
  feature text, calls bigint, usd numeric, tokens_in bigint, tokens_out bigint,
  avg_ms int, p95_ms int, failed bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(l.feature, 'unattributed'),
    count(*),
    round(COALESCE(sum(l.cost_usd), 0)::numeric, 6),
    COALESCE(sum(l.tokens_in), 0),
    COALESCE(sum(l.tokens_out), 0),
    round(avg(l.ms))::int,
    percentile_disc(0.95) WITHIN GROUP (ORDER BY l.ms)::int,
    count(*) FILTER (WHERE NOT l.ok)
  FROM edu.ai_call_log l
  WHERE l.created_at > now() - make_interval(hours => p_hours)
  GROUP BY 1
  ORDER BY 3 DESC NULLS LAST, 2 DESC
  LIMIT 50;
$$;

-- ── What each tier really costs ──────────────────────────────────────────
-- The price list says what a model costs per token. This says what it costs
-- per CALL here, which is the number a routing change actually moves.
CREATE OR REPLACE FUNCTION edu.ai_spend_by_model(p_hours int DEFAULT 24)
RETURNS TABLE (
  model text, calls bigint, usd numeric, usd_per_call numeric,
  avg_ms int, p95_ms int, avg_tokens_out int, failed bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    l.model,
    count(*),
    round(COALESCE(sum(l.cost_usd), 0)::numeric, 6),
    round((COALESCE(sum(l.cost_usd), 0) / GREATEST(count(*), 1))::numeric, 8),
    round(avg(l.ms))::int,
    percentile_disc(0.95) WITHIN GROUP (ORDER BY l.ms)::int,
    round(avg(l.tokens_out))::int,
    count(*) FILTER (WHERE NOT l.ok)
  FROM edu.ai_call_log l
  WHERE l.created_at > now() - make_interval(hours => p_hours)
  GROUP BY 1
  ORDER BY 3 DESC NULLS LAST
  LIMIT 50;
$$;

-- ── Is today normal? ─────────────────────────────────────────────────────
-- Bucketed so a long window stays a readable number of points: hourly up to
-- two days, daily beyond. A total with nothing either side of it answers
-- nothing.
CREATE OR REPLACE FUNCTION edu.ai_spend_series(p_hours int DEFAULT 24)
RETURNS TABLE (bucket timestamptz, calls bigint, usd numeric, p95_ms int, failed bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    date_trunc(CASE WHEN p_hours > 48 THEN 'day' ELSE 'hour' END, l.created_at),
    count(*),
    round(COALESCE(sum(l.cost_usd), 0)::numeric, 6),
    percentile_disc(0.95) WITHIN GROUP (ORDER BY l.ms)::int,
    count(*) FILTER (WHERE NOT l.ok)
  FROM edu.ai_call_log l
  WHERE l.created_at > now() - make_interval(hours => p_hours)
  GROUP BY 1
  ORDER BY 1;
$$;

-- ── What is failing ──────────────────────────────────────────────────────
-- Grouped by KIND, never by message: a dashboard needs "rate limited, 42
-- times", not forty-two variations of one sentence.
CREATE OR REPLACE FUNCTION edu.ai_spend_failures(p_hours int DEFAULT 24)
RETURNS TABLE (error_kind text, feature text, model text, calls bigint, last_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(l.error_kind, 'unknown'),
    COALESCE(l.feature, 'unattributed'),
    l.model,
    count(*),
    max(l.created_at)
  FROM edu.ai_call_log l
  WHERE l.created_at > now() - make_interval(hours => p_hours)
    AND NOT l.ok
  GROUP BY 1, 2, 3
  ORDER BY 4 DESC
  LIMIT 25;
$$;

-- PostgREST executes RPC as the request role; these read one table and are
-- reached only through an admin-guarded route.
GRANT EXECUTE ON FUNCTION edu.ai_spend_by_feature(int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION edu.ai_spend_by_model(int)   TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION edu.ai_spend_series(int)     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION edu.ai_spend_failures(int)   TO anon, authenticated, service_role;

-- Verify:
--   SELECT * FROM edu.ai_spend_by_feature(24);
--   SELECT * FROM edu.ai_spend_by_model(24);
