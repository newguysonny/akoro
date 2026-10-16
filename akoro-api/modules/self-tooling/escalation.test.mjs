import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { rowsText, requestLine, escalate } from "./escalation.js";
import { CAPABILITIES } from "./capabilities.js";
import { CAP_RUNNERS } from "./capRuntime.js";

test("posted answers read as a short list, capped", () => {
  assert.equal(rowsText([]), "There's nothing to show yet.");
  const t = rowsText(Array.from({ length: 12 }, (_, i) => ({ player: `P${i}`, score: i + 0.456 })));
  assert.match(t, /• player: P0, score: 0\.46/);
  assert.match(t, /…and 2 more\./);
});

test("request lines are learner language", () => {
  assert.match(requestLine("battles.class_results"), /^Asked an admin for permission: results of the other players/);
});

test("runtime capabilities have runners; the probe is hidden and harmless", () => {
  for (const [name, c] of Object.entries(CAPABILITIES)) if (c.runtime) assert.equal(typeof CAP_RUNNERS[name], "function", name);
  assert.equal(CAPABILITIES["verify.probe"].hidden, true);
  assert.equal(CAPABILITIES["verify.probe"].status, "locked");
  assert.equal(CAPABILITIES["battles.class_results"].kind, "read");
});

test("escalate refuses what a grant couldn't satisfy, and dry runs make no request", async () => {
  assert.equal((await escalate({ learnerId: "u", capability: "tasks.mark_done", goal: "mark my task done", proposed: {} })).status, "rejected");
  assert.equal((await escalate({ learnerId: "u", capability: "others.private_data", goal: "x", proposed: {} })).status, "rejected");
  assert.equal((await escalate({ learnerId: "u", capability: "learner.context", goal: "x", proposed: {} })).status, "rejected");
  const dry = await escalate({ learnerId: "u", capability: "battles.class_results", goal: "how I did against classmates", proposed: {}, dry: true });
  assert.equal(dry.status, "escalated");
  assert.equal(dry.dryRun, true);
  assert.equal(dry.requestId, undefined, "no request id without a real row");
});

test("wiring: capability statuses only via decide; resume falls back in-process", () => {
  const admin = readFileSync(new URL("../admin/agent-tool-requests.js", import.meta.url), "utf8");
  assert.match(admin, /DECISION_ONLY_STATUSES\.has\(update\.status\)/);
  assert.match(admin, /router\.post\("\/agent-tool-requests\/:requestId\/decide", adminOnly/);
  assert.match(admin, /router\.post\("\/capability-grants\/:grantId\/revoke", adminOnly/);
  const q = readFileSync(new URL("./resumeQueue.js", import.meta.url), "utf8");
  assert.match(q, /if \(worker\) \{[\s\S]*return \{ mode: "queue" \};[\s\S]*return \{ mode: "inline" \};/);
  const esc = readFileSync(new URL("./escalation.js", import.meta.url), "utf8");
  assert.match(esc, /\.eq\("status", "approved"\)\.in\("resume_status", \["waiting", "failed"\]\)/, "resume claims the row atomically");
});

test("a goal about other learners escalates only when a locked network capability ranks first", async () => {
  const { othersCapabilityFirst } = await import("./pipeline.js");
  const battle = [{ name: "battles.class_results", status: "needs_approval" }, { name: "agents.search", status: "available" }];
  assert.equal(othersCapabilityFirst("how did the other players score compared to me in my battles", battle), "battles.class_results");
  assert.equal(othersCapabilityFirst("my battle scores this month", battle), null, "not about others");
  const league = [{ name: "league.weekly", status: "available" }, { name: "battles.class_results", status: "needs_approval" }];
  assert.equal(othersCapabilityFirst("how do I compare to others in the weekly league", league), null, "an available capability ranks first — build");
});
