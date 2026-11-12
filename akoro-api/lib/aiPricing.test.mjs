import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_MARKUP, COIN_USD, DEFAULT_MODEL_PRICES,
  coinsForReportedCost, hasModelPrice, reportedCostUsd, usdCost,
} from "./aiPricing.js";

const PRICES = {
  "deepseek": { in: 0.30, out: 1.20, cachedIn: 0.006 },
  "deepseek-v4.1-flash": { in: 0.30, out: 1.20, cachedIn: 0.006 },
  "glm-5-3-flash": { in: 0.15, out: 0.50, cachedIn: 0.03 },
  "glm-5.3-flash": { in: 0.15, out: 0.50, cachedIn: 0.03 },
  "qwen3-8-flash": { in: 0.15, out: 0.47, cachedIn: 0.016 },
  "qwen3.8-flash": { in: 0.15, out: 0.47, cachedIn: 0.016 },
  "claude-haiku": { in: 0.10, out: 0.50, cachedIn: 0.01 },
  "claude-haiku-5-5": { in: 0.10, out: 0.50, cachedIn: 0.01 },
  "gpt-6-luna": { in: 0.10, out: 0.50, cachedIn: 0.01 },
  "gpt-5-6-luna": { in: 0.20, out: 1.20, cachedIn: 0.02 },
  "gpt-5.6-luna": { in: 0.20, out: 1.20, cachedIn: 0.02 },
  "grok": { in: 2.00, out: 6.00, cachedIn: 0.50 },
  "grok-4.7": { in: 2.00, out: 6.00, cachedIn: 0.50 },
};

test("catalogue ids and apiModel names are priced", () => {
  for (const [name, price] of Object.entries(PRICES)) {
    assert.ok(hasModelPrice(name), `${name} is priced`);
    assert.deepEqual(DEFAULT_MODEL_PRICES[name], price, name);
  }
});

test("lookups bill under both the id and the apiModel name", () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  close(usdCost("deepseek", 1e6, 1e6), 1.50);
  close(usdCost("deepseek-v4.1-flash", 1e6, 1e6), 1.50);
  close(usdCost("glm-5-3-flash", 1e6, 1e6), 0.65);
  close(usdCost("glm-5.3-flash", 1e6, 1e6), 0.65);
  close(usdCost("qwen3-8-flash", 1e6, 1e6), 0.62);
  close(usdCost("qwen3.8-flash", 1e6, 1e6), 0.62);
  close(usdCost("claude-haiku", 1e6, 1e6), 0.60);
  close(usdCost("claude-haiku-5-5", 1e6, 1e6), 0.60);
  close(usdCost("gpt-6-luna", 1e6, 1e6), 0.60);
  close(usdCost("gpt-5-6-luna", 1e6, 1e6), 1.40);
  close(usdCost("gpt-5.6-luna", 1e6, 1e6), 1.40);
  close(usdCost("grok", 1e6, 1e6), 8.00);
  close(usdCost("grok-4.7", 1e6, 1e6), 8.00);
});

test("reportedCostUsd reads usage.cost and usage.opencode.cost", () => {
  assert.equal(reportedCostUsd({ cost: 0.0123 }), 0.0123);
  assert.equal(reportedCostUsd({ opencode: { cost: 0.5 } }), 0.5);
  assert.equal(reportedCostUsd({ cost: 0.2, opencode: { cost: 0.5 } }), 0.2);
  assert.equal(reportedCostUsd({ cost: 0 }), 0);
  assert.equal(reportedCostUsd({}), null);
  assert.equal(reportedCostUsd(null), null);
  assert.equal(reportedCostUsd({ cost: -1 }), null);
  assert.equal(reportedCostUsd({ opencode: { cost: -0.1 } }), null);
  assert.equal(reportedCostUsd({ cost: "not-a-number" }), null);
});

test("coinsForReportedCost applies markup/coin math with a minimum of 1", () => {
  assert.equal(coinsForReportedCost(0), 1);
  assert.equal(coinsForReportedCost(-1), 1);
  assert.equal(coinsForReportedCost(undefined), 1);
  assert.equal(coinsForReportedCost(0.0007), 2);
  const cost = 0.0123;
  assert.equal(coinsForReportedCost(cost), Math.max(1, Math.ceil(cost * AI_MARKUP / COIN_USD)));
});

test("aiTelemetry: provider fields are present only when provided", async () => {
  process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_KEY ||= "test";
  process.env.AI_TELEMETRY = "on";
  process.env.AI_TELEMETRY_DB = "off";
  const { recordAiCall } = await import("./aiTelemetry.js");

  const lines = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    recordAiCall({ feature: "chat", model: "deepseek", ms: 12 });
    recordAiCall({
      feature: "chat", model: "deepseek", ms: 13,
      provider: "opencode", lane: "go", billingSource: "go",
      providerCostUsd: 0.02, listCostUsd: 0.03, allowanceUsd: 5,
      cacheRead: 10, cacheWrite: 2,
    });
  } finally {
    process.stdout.write = write;
  }

  const [oldEntry, newEntry] = lines.map((line) => JSON.parse(line));
  assert.deepEqual(Object.keys(oldEntry).sort(), [
    "cached_in", "cost_usd", "error_kind", "event", "feature", "level", "message",
    "model", "ms", "ok", "ref", "streamed", "tokens_in", "tokens_out", "ts", "ttfb_ms", "user_id",
  ].sort());
  for (const key of ["provider", "lane", "billing_source", "provider_cost_usd", "list_cost_usd", "allowance_usd", "cache_read", "cache_write"]) {
    assert.ok(!(key in oldEntry), `${key} absent when not provided`);
  }
  assert.equal(newEntry.provider, "opencode");
  assert.equal(newEntry.lane, "go");
  assert.equal(newEntry.billing_source, "go");
  assert.equal(newEntry.provider_cost_usd, 0.02);
  assert.equal(newEntry.list_cost_usd, 0.03);
  assert.equal(newEntry.allowance_usd, 5);
  assert.equal(newEntry.cache_read, 10);
  assert.equal(newEntry.cache_write, 2);
});
