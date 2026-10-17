// D42: a learner moves up a teaching phase only when the evidence shows they
// understood — on every path. A guide choice (switch agent, a trained agent,
// a saved preference) changes only the GUIDE inside the gated student session.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";
delete process.env.REDIS_URL;

const { default: db } = await import("../../../db.js");
const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");
const { getOrchestrator } = await import("./registry.js");
const { StudentSessionOrchestrator } = await import("./student/orchestrator.js");
const { NaNaEsumaiOrchestrator } = await import("./nana-esumai/orchestrator.js");
const { TrainedOrchestrator } = await import("./trained/orchestrator.js");

const L = "11111111-1111-4111-8111-111111111111";

function fake(t, { owns = false, prefs = null } = {}) {
  const f = installFakeDb(db, prefs ? { user_agent_preferences: [{ user_id: L, ...prefs }] } : {}, { rpc: { edu_user_owns_agent: () => ({ data: owns }) } });
  t.after(() => f.restore());
  return f;
}

for (const [label, args] of [
  ["a built-in guide pair", { agentPairId: "nana-esumai" }],
  ["a trained guide pair the learner doesn't own", { agentPairId: "trained:abc" }],
  ["a trained agent id", { agentId: "abc" }],
  ["no guide given (saved preference)", {}],
  ["mode student", { mode: "student" }],
]) {
  test(`${label} → always the gated student session`, async (t) => {
    fake(t, { prefs: { guide_pair_id: "trained:abc" } });
    const o = await getOrchestrator({ ...args, studentId: L, userId: L });
    assert.ok(o instanceof StudentSessionOrchestrator, `got ${o?.constructor?.name}`);
    assert.ok(!(o instanceof NaNaEsumaiOrchestrator) && !(o instanceof TrainedOrchestrator));
    assert.ok(o.guideOrchestrator, "it always has a guide (NaNa by default)");
  });
}

test("a guide the learner doesn't own falls back to NaNa — the session is unchanged", async (t) => {
  fake(t, { owns: false });
  const o = await getOrchestrator({ mode: "student", studentId: L, userId: L, teacherAgentId: "not-mine" });
  assert.ok(o instanceof StudentSessionOrchestrator);
  assert.ok(o.guideOrchestrator instanceof NaNaEsumaiOrchestrator);
});

test("session type, subject and decay material go into the student session", async (t) => {
  fake(t);
  const decayPayload = { subject: "Biology", topic: "Cells", confidence: 0.3 };
  const o = await getOrchestrator({ mode: "student", studentId: L, userId: L, sessionType: "decay_review", decayPayload });
  assert.equal(o.sessionType, "decay_review");
  assert.equal(o.subject, "Biology");
  assert.deepEqual(o.decayPayload, decayPayload);
});

test("no learner → no session", async (t) => {
  fake(t);
  assert.equal(await getOrchestrator({ agentPairId: "nana-esumai" }), null);
});

test("guide pairs refuse to run a teaching turn themselves", async () => {
  await assert.rejects(new NaNaEsumaiOrchestrator().processTeachingMessage("hi"), /D42/);
  await assert.rejects(TrainedOrchestrator.prototype.processTeachingMessage.call({}, "hi"), /D42/);
});

test("websocket: the old starts are retired; start passes the chosen guide; switch keeps the session", () => {
  const ws = readFileSync(new URL("../websocket.js", import.meta.url), "utf8");
  assert.match(ws, /for \(const retired of \["start_session", "start_student_session", "start_decay_session"\]\)/);
  assert.match(ws, /code: "retired_event"/);
  assert.doesNotMatch(ws, /socket\.on\("start_session", async/);
  assert.match(ws, /teacherAgentId:\s+typeof teacherAgentId === "string"/, "start_adaptive_session uses the learner's chosen guide");
  const sw = ws.slice(ws.indexOf('socket.on("switch_agent_pair"'), ws.indexOf("// ── get_knowledge_health"));
  for (const kept of ["sessionType:  priorOrchestrator?.sessionType", "decayPayload: priorOrchestrator?.decayPayload", "orchestrator.session.history = priorOrchestrator.session.history", "teachingEvidence: serialiseTeachingEvidence(priorOrchestrator?.teachingEvidence)", "phase: priorOrchestrator.session.phase"]) {
    assert.ok(sw.includes(kept), `switch keeps: ${kept}`);
  }
  assert.match(sw, /code: "UNKNOWN_GUIDE"/);
});
