-- =============================================================
-- 2026-ai-call-log.sql
-- One row per model call, so cost and latency can be asked about.
--
-- The wallet already recorded model, tokens and cost — but only for calls it
-- CHARGED. A system or cron call had no payer, so nothing was written, and the
-- platform's own background AI usage was invisible. Latency was recorded
-- nowhere at all: of cost, latency and quality, one was measured, one was
-- missing, and the measured one had a hole in it.
--
-- Separate from coin_transactions on purpose. That table is a financial ledger
-- — every row is money moved, and it should not grow rows for unbilled calls
-- or carry fields that have nothing to do with a balance.
--
-- ttfb_ms is kept apart from ms because for chat they answer different
-- questions: a four-second completion that starts printing in 300ms reads as
-- fast, and averaging them would hide exactly that.
-- =============================================================

CREATE TABLE IF NOT EXISTS edu.ai_call_log (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  feature     TEXT,                    -- 'tutor_chat', 'battle_generate', 'task:assign_battle'…
  model       TEXT NOT NULL,
  ms          INTEGER NOT NULL,        -- wall time for the whole call
  ttfb_ms     INTEGER,                 -- to first streamed chunk; NULL when not streamed
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  cached_in   INTEGER NOT NULL DEFAULT 0,
  cost_usd    NUMERIC(12, 8),
  streamed    BOOLEAN NOT NULL DEFAULT false,
  ok          BOOLEAN NOT NULL DEFAULT true,
  error_kind  TEXT,                    -- rate_limited | auth | upstream_5xx | timeout | …
  user_id     UUID,                    -- no FK: this outlives the user row
  ref         TEXT
);

-- The three questions this table exists to answer:
--   "what is it costing us, by feature?"      → feature + created_at
--   "what is slow?"                            → model + created_at
--   "what is failing?"                         → partial index on failures
CREATE INDEX IF NOT EXISTS idx_ai_call_log_feature_time ON edu.ai_call_log (feature, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_model_time   ON edu.ai_call_log (model, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_failures     ON edu.ai_call_log (created_at DESC) WHERE ok = false;

COMMENT ON TABLE edu.ai_call_log IS
  'One row per model call, billed or not. Cost/latency telemetry — NOT a financial record; coin_transactions is the ledger.';

-- Verify:
--   SELECT feature, model, count(*), round(avg(ms)) AS avg_ms,
--          percentile_disc(0.95) WITHIN GROUP (ORDER BY ms) AS p95_ms,
--          round(sum(cost_usd)::numeric, 4) AS usd
--   FROM edu.ai_call_log
--   WHERE created_at > now() - interval '24 hours'
--   GROUP BY feature, model ORDER BY usd DESC NULLS LAST;
