// Telemetry must be invisible when it fails and must never store a whole
// learner document. These tests exercise the pure shaping and the off switch.
import assert from "node:assert/strict";
import test from "node:test";
import { normaliseQuery, queryHash, sanitiseMeta, telemetryEnabled, recordRetrieval } from "./retrievalTelemetry.js";

test("queries are normalised and bounded", () => {
  assert.equal(normaliseQuery("  what   is\n\nphotosynthesis "), "what is photosynthesis");
  assert.equal(normaliseQuery("x".repeat(400)).length, 300);
  assert.equal(queryHash("What Is Photosynthesis"), queryHash("what is photosynthesis"));
  assert.notEqual(queryHash("a"), queryHash("b"));
});

test("oversized meta is truncated, malformed meta is dropped", () => {
  assert.deepEqual(sanitiseMeta(null), {});
  assert.deepEqual(sanitiseMeta("nope"), {});
  assert.deepEqual(sanitiseMeta({ big: "x".repeat(5000) }), { truncated: true });
  assert.deepEqual(sanitiseMeta({ rerank: true }), { rerank: true });
});

test("RETRIEVAL_TELEMETRY=off disables writes", async () => {
  const prev = process.env.RETRIEVAL_TELEMETRY;
  process.env.RETRIEVAL_TELEMETRY = "off";
  try {
    assert.equal(telemetryEnabled(), false);
    await recordRetrieval({ surface: "library", phase: "retrieval", query: "x" }); // resolves, no db
  } finally {
    if (prev === undefined) delete process.env.RETRIEVAL_TELEMETRY; else process.env.RETRIEVAL_TELEMETRY = prev;
  }
});
