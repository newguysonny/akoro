/**
 * modules/verify/usage.js — what a run cost: the model calls edu.ai_call_log
 * recorded for the run's accounts between its start and end.
 *
 *   summariseUsage(rows, accountIds) → { calls, failed, tokensIn, tokensOut, cachedIn, costUsd, byModel, unattributed }
 *   runUsage({ accountIds, from, to }) → the same, or { unavailable } when the log can't be read
 *
 * Calls with no user (background work billed to the platform, e.g. a past
 * paper's structure pass) can't be tied to a run, so they are shown apart as
 * `unattributed`: everything the server did in that window with no owner. On
 * the sandbox that is almost always the gate; if two runs overlap, both see it.
 */
import db from "../../db.js";
import { summariseUsage, USAGE_LIMITS } from "./usageCore.js";

export { summariseUsage };

export async function runUsage({ accountIds = [], from, to }) {
  const ids = [...new Set(accountIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(String(id)));
  // Telemetry rows are written fire-and-forget; give the last call's a moment to land.
  await new Promise((r) => setTimeout(r, USAGE_LIMITS.SETTLE_MS));
  let q = db.schema("edu").from("ai_call_log").select("user_id, model, tokens_in, tokens_out, cached_in, cost_usd, ok")
    // created_at is when the row landed, a moment after the call: count up to now, not just `to`.
    .gte("created_at", from).lte("created_at", new Date().toISOString()).limit(USAGE_LIMITS.ROWS);
  q = ids.length ? q.or(`user_id.is.null,user_id.in.(${ids.join(",")})`) : q.is("user_id", null);
  const { data, error } = await q;
  if (error) return { unavailable: error.message };
  return { ...summariseUsage(data || [], ids), from, to, ...(data?.length >= USAGE_LIMITS.ROWS ? { truncated: true } : {}) };
}
