import test from "node:test";
import assert from "node:assert/strict";
import { summariseUsage } from "./usageCore.js";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";

test("a run's cost: its accounts' calls, by model, with no-owner calls kept apart", () => {
  const u = summariseUsage([
    { user_id: A, model: "deepseek-chat", tokens_in: 12000, tokens_out: 400, cached_in: 8000, cost_usd: "0.0035", ok: true },
    { user_id: B, model: "deepseek-chat", tokens_in: 3000, tokens_out: 100, cached_in: 0, cost_usd: 0.00088, ok: false },
    { user_id: A, model: "deepgram-aura-2", tokens_in: 0, tokens_out: 0, cost_usd: 0.003, ok: true },
    { user_id: OTHER, model: "deepseek-chat", tokens_in: 99999, tokens_out: 9999, cost_usd: 1, ok: true },
    { user_id: null, model: "deepseek-chat", tokens_in: 5000, tokens_out: 900, cost_usd: 0.0018, ok: true },
  ], [A, B]);
  assert.equal(u.calls, 3);
  assert.equal(u.failed, 1);
  assert.equal(u.tokensIn, 15000);
  assert.equal(u.tokensOut, 500);
  assert.equal(u.cachedIn, 8000);
  assert.equal(u.costUsd, 0.00738);
  assert.deepEqual(u.byModel.map((m) => [m.model, m.calls]), [["deepseek-chat", 2], ["deepgram-aura-2", 1]]);
  assert.deepEqual({ calls: u.unattributed.calls, tokensIn: u.unattributed.tokensIn, costUsd: u.unattributed.costUsd }, { calls: 1, tokensIn: 5000, costUsd: 0.0018 });
});

test("nothing logged is zero, not an error", () => {
  const u = summariseUsage([], [A]);
  assert.equal(u.calls, 0);
  assert.equal(u.costUsd, 0);
  assert.deepEqual(u.byModel, []);
});
