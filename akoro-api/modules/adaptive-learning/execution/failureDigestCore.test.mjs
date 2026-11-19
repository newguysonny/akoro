import test from "node:test";
import assert from "node:assert/strict";
import { clusterFailures, lessonFor, digestText } from "./failureDigestCore.js";

const step = (tool, error_class, error_message = "") => ({ tool, error_class, error_message });

test("clusters by tool + error class, strongest first, min count respected", () => {
  const steps = [
    step("schedule_chat_follow_up", "unavailable", "503"),
    step("schedule_chat_follow_up", "unavailable", "503"),
    step("schedule_chat_follow_up", "unavailable", "503"),
    step("list_tasks", "timeout", "timed out"),
    step("list_tasks", "timeout", "timed out"),
  ];
  const clusters = clusterFailures(steps, { minCount: 2 });
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].tool, "schedule_chat_follow_up");
  assert.equal(clusters[0].count, 3);
  assert.equal(clusters[1].tool, "list_tasks");
  // a cluster below minCount is dropped
  assert.equal(clusterFailures([step("x", "timeout")], { minCount: 2 }).length, 0);
});

test("caps samples per cluster to two distinct messages", () => {
  const steps = [
    step("t", "error", "a"), step("t", "error", "a"), step("t", "error", "b"),
    step("t", "error", "c"), step("t", "error", "c"),
  ];
  const [c] = clusterFailures(steps, { minCount: 1 });
  assert.equal(c.samples.length, 2);
  assert.deepEqual(c.samples, ["a", "b"]);
});

test("lessonFor gives class-specific advice", () => {
  assert.match(lessonFor({ tool: "t", errorClass: "rate_limit", count: 4, samples: [] }), /back off/);
  assert.match(lessonFor({ tool: "t", errorClass: "auth", count: 2, samples: [] }), /do not retry/);
  assert.match(lessonFor({ tool: "t", errorClass: "database", count: 2, samples: [] }), /schema\/field mismatch/);
  assert.match(lessonFor({ tool: "t", errorClass: "unavailable", count: 3, samples: ["503"] }), /failed 3× with unavailable/);
});

test("digestText summarises and is null when empty", () => {
  assert.equal(digestText([]), null);
  const text = digestText(clusterFailures([step("a", "timeout"), step("a", "timeout")], { minCount: 1 }));
  assert.match(text, /2 repeated tool failures/);
  assert.match(text, /- a failed 2× with timeout/);
});
