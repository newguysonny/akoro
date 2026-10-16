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
  assert.equal((await escalate({ learnerId: "u", capability: "circles.leave", goal: "leave my circle", proposed: {} })).status, "rejected");
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

test("library: similar goals over the same data group; analytics summarise", async () => {
  const { goalSimilarity, groupSimilar, summarise } = await import("./library.js");
  assert.ok(goalSimilarity("How many tasks I have by status", "count my tasks by status") >= 0.4);
  assert.ok(goalSimilarity("How many tasks I have by status", "hours of learning sessions per month") < 0.2);
  const t = (id, goal, views, owner, scope = "learner") => ({ id, goal, views, capabilities: [], owner_id: owner, scope, usage_count: 1 });
  const groups = groupSimilar([
    t("a", "How many tasks I have by status", ["my_tasks"], "u1"),
    t("b", "count my tasks by status", ["my_tasks"], "u2"),
    t("c", "tasks by status", ["my_goals"], "u3"),
    t("d", "session hours per month", ["my_learning_sessions"], "u4"),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].tools.map((x) => x.id).sort(), ["a", "b"]);
  assert.equal(groups[0].owners, 2);
  const s = summarise({ days: 2, now: Date.parse("2026-10-16T12:00:00Z"),
    events: [{ user_id: "u1", outcome: "created", mode: "recipe", builder_calls: 2, ms: 900, created_at: "2026-10-16T10:00:00Z" },
      { user_id: "u2", outcome: "rejected", reason: "Couldn't build it safely: 3 errors", ms: 400, created_at: "2026-10-15T10:00:00Z" }],
    requests: [{ requester_id: "u1", requested_capability: "battles.class_results", status: "new" }, { requester_id: "u2", requested_capability: "battles.class_results", status: "new" }],
    tools: [{ id: "x", label: "X", scope: "platform", status: "active", usage_count: 5, fail_streak: 1 }] });
  assert.equal(s.goals.total, 2);
  assert.deepEqual(s.goals.byOutcome, { created: 1, rejected: 1 });
  assert.equal(s.goals.daily.length, 2);
  assert.equal(s.goals.daily[1].created, 1);
  assert.equal(s.requests.topCapabilities[0].learners, 2);
  assert.equal(s.tools.platform, 1);
  assert.equal(s.tools.failing.length, 1);
  assert.match(s.goals.topRejections[0].key, /#/);
});

test("catalogue: platform tools join the learner's own; own wins a name clash; platform never auto-disables", () => {
  const src = readFileSync(new URL("./pipeline.js", import.meta.url), "utf8");
  assert.match(src, /\.eq\("scope", "platform"\)\.eq\("status", "active"\)/);
  assert.match(src, /filter\(\(t\) => !own\.has\(t\.name\)\)/);
  assert.match(src, /fail >= 3 && !platform \? \{ status: "disabled" \}/);
});

test("scheduling goals go to code first", async () => {
  const { needsCode } = await import("./pipeline.js");
  assert.ok(needsCode("Spread my weak topics over the days until my exam on 2026-11-06: two topics a day, weakest first, skipping Sundays"));
  assert.ok(needsCode("plan out my revision, 3 topics per day"));
  assert.ok(!needsCode("How many tasks I have by status"));
  assert.ok(!needsCode("total hours of my learning sessions per month this year"));
});

test("write steps: last op, rows from the target view, never grouped, and the capability must be on", async () => {
  const { validateDefinition } = await import("./interpreters.js");
  const tasks = { id: "t", view: "my_tasks", where: [{ field: "status", op: "eq", value: "pending" }] };
  const ok = await validateDefinition({ kind: "recipe", steps: [tasks], then: [{ op: "sort", by: "due_at" }, { op: "write", cap: "tasks.mark_done" }] }, {});
  assert.deepEqual(ok.errors.filter((e) => !/needs approval/.test(e)), [], "only the grant is missing (no DB grant here)");
  assert.ok(ok.uses.capabilities.includes("tasks.mark_done"));
  const grouped = await validateDefinition({ kind: "recipe", steps: [tasks], then: [{ op: "group", by: ["status"], count: true }, { op: "write", cap: "tasks.mark_done" }] }, {});
  assert.ok(grouped.errors.some((e) => /works on rows from my_tasks/.test(e)));
  const notLast = await validateDefinition({ kind: "recipe", steps: [tasks], then: [{ op: "write", cap: "tasks.mark_done" }, { op: "limit", n: 3 }] }, {});
  assert.ok(notLast.errors.some((e) => /last step/.test(e)));
  const wrongView = await validateDefinition({ kind: "recipe", steps: [{ id: "g", view: "my_goals" }], then: [{ op: "write", cap: "tasks.mark_done" }] }, {});
  assert.ok(wrongView.errors.some((e) => /rows from my_tasks/.test(e)));
  const notWrite = await validateDefinition({ kind: "recipe", steps: [tasks], then: [{ op: "write", cap: "tasks.list_mine" }] }, {});
  assert.ok(notWrite.errors.some((e) => /isn't a write/.test(e)));
  const noTarget = await validateDefinition({ kind: "recipe", steps: [tasks], then: [{ op: "write", cap: "circles.leave" }] }, {});
  assert.ok(noTarget.errors.some((e) => /isn't a write/.test(e)));
});

test("a row's private id survives pick but never leaves the server", async () => {
  const O = await import("./ops.js");
  const rows = [{ title: "A", status: "pending", _ref: "id-1" }];
  assert.deepEqual(O.pick(rows, { fields: ["title"] }), [{ title: "A", _ref: "id-1" }]);
  assert.deepEqual(O.stripRefs(O.pick(rows, { fields: ["title"] })), [{ title: "A" }]);
  assert.equal("_ref" in O.group(rows, { by: ["status"], count: true })[0], false);
});
