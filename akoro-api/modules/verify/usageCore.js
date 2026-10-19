/**
 * modules/verify/usageCore.js — a run's model calls summed into what it cost.
 * Pure — no db (usage.js reads the log).
 */
export const USAGE_LIMITS = Object.freeze({ ROWS: 5000, SETTLE_MS: 1500 });

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;
const empty = () => ({ calls: 0, failed: 0, tokensIn: 0, tokensOut: 0, cachedIn: 0, costUsd: 0 });
const add = (t, r) => {
  t.calls += 1;
  if (r.ok === false) t.failed += 1;
  t.tokensIn += Number(r.tokens_in) || 0;
  t.tokensOut += Number(r.tokens_out) || 0;
  t.cachedIn += Number(r.cached_in) || 0;
  t.costUsd += Number(r.cost_usd) || 0;
};
const done = (t) => ({ ...t, costUsd: round(t.costUsd, 6) });

export function summariseUsage(rows = [], accountIds = []) {
  const ids = new Set(accountIds);
  const total = empty();
  const unattributed = empty();
  const models = new Map();
  for (const r of rows) {
    if (!r.user_id) { add(unattributed, r); continue; }
    if (!ids.has(r.user_id)) continue;
    add(total, r);
    if (!models.has(r.model)) models.set(r.model, empty());
    add(models.get(r.model), r);
  }
  return {
    ...done(total),
    byModel: [...models.entries()].map(([model, t]) => ({ model, ...done(t) })).sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls),
    unattributed: done(unattributed),
  };
}
