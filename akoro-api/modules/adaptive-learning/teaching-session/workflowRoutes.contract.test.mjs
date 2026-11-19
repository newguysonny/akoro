// Grand Plan §15 "Teaching", Scenario A, Phase 11: POST /api/teaching/workflows
// makes a direct teaching session a workflow BEFORE the modal opens — the
// learner from the token, never the body; one open direct session per topic;
// the owner alone reads or resumes it; the dashboard routes it to the
// teaching modal with its workflowId. In memory: the real engine and a memory store.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import express from "express";
import { createWorkflowEngine } from "../../workflows/index.js";
import { memoryWorkflowStore } from "../../workflows/index.js";
import { describeWorkflow } from "../../workflows/index.js";
import "./workflow.js";
import { createTeachingWorkflowsRouter, directSessionInput } from "./workflowRoutes.js";

test("the body: a topic is required; mode and focus are checked and bounded", () => {
  assert.deepEqual(directSessionInput({}), { error: "topic is required" });
  assert.match(directSessionInput({ topic: "Water cycle", mode: "lecture" }).error, /mode must be one of/);
  assert.match(directSessionInput({ topic: "Water cycle", focus: "x" }).error, /list/);
  const ok = directSessionInput({ topic: "  The   water cycle ", subject: "Basic Science", focus: ["a", "a", "b", "", "c", "d", "e", "f", "g"] });
  assert.deepEqual(ok, { topic: "The water cycle", subject: "Basic Science", mode: "teach_agent", focus: ["a", "b", "c", "d", "e", "f"] });
  assert.equal(directSessionInput({ topic: "Osmosis", mode: "learn_with_guide" }).mode, "learn_with_guide");
});

async function withServer(t, fn, { enabled = () => true } = {}) {
  const store = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store, publish: () => {} });
  const app = express();
  app.use(express.json());
  const authenticate = (req, res, next) => { const id = req.headers["x-user"]; if (!id) return res.status(401).end(); req.user = { id }; return next(); };
  app.use("/api/teaching/workflows", createTeachingWorkflowsRouter({ engine: () => engine, authenticate, enabled }));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/teaching/workflows`;
  const call = async (who, method, path = "", body) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(who ? { "x-user": who } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: r.status === 401 ? null : await r.json() };
  };
  await fn({ call, engine });
}

test("create: a scheduled teaching workflow (entry direct) for the token's learner; a repeat reopens it", async (t) => {
  await withServer(t, async ({ call, engine }) => {
    const r = await call("ada", "POST", "", { topic: "Evaporation", subject: "Basic Science", learnerId: "someone-else", focus: ["Evaporation vs transpiration"] });
    assert.equal(r.status, 201);
    assert.equal(r.body.created, true);
    const row = await engine.get(r.body.workflowId);
    assert.deepEqual({ learner: row.learner_id, type: row.workflow_type, entry: row.entry_mode, state: row.state, status: row.status },
      { learner: "ada", type: "teaching", entry: "direct", state: "scheduled", status: "waiting_learner" }, "the body's learnerId is ignored");
    assert.deepEqual(r.body.workflow.focus, ["Evaporation vs transpiration"]);
    const events = await engine.events(row.id);
    assert.deepEqual(events.map((e) => [e.event_type, e.visibility]), [["workflow.created", "learner"]]);

    const again = await call("ada", "POST", "", { topic: "  evaporation " });
    assert.deepEqual({ status: again.status, created: again.body.created, id: again.body.workflowId }, { status: 200, created: false, id: r.body.workflowId }, "one open direct session per topic");
    const other = await call("ada", "POST", "", { topic: "Condensation" });
    assert.notEqual(other.body.workflowId, r.body.workflowId);
    const bob = await call("bob", "POST", "", { topic: "Evaporation" });
    assert.notEqual(bob.body.workflowId, r.body.workflowId, "another learner gets their own");
    assert.equal((await call("ada", "POST", "", { topic: "" })).status, 422);
    assert.equal((await call(null, "POST", "", { topic: "Evaporation" })).status, 401);
  });
});

test("a finished direct session is not reopened: the next start makes a new one", async (t) => {
  await withServer(t, async ({ call, engine }) => {
    const first = await call("ada", "POST", "", { topic: "Evaporation" });
    await engine.cancel(first.body.workflowId, "test");
    const next = await call("ada", "POST", "", { topic: "Evaporation" });
    assert.equal(next.status, 201);
    assert.notEqual(next.body.workflowId, first.body.workflowId);
  });
});

test("read and resume: the owner only; a finished one is 409", async (t) => {
  await withServer(t, async ({ call, engine }) => {
    const { body } = await call("ada", "POST", "", { topic: "Evaporation", mode: "learn_with_guide" });
    const id = body.workflowId;
    assert.equal((await call("ada", "GET", `/${id}`)).body.workflow.workflowId, id);
    assert.equal((await call("bob", "GET", `/${id}`)).status, 404);
    assert.equal((await call("ada", "GET", "/not-a-uuid")).status, 422);
    const resume = await call("ada", "POST", `/${id}/resume`);
    assert.deepEqual(resume.body.open, { surface: "teaching_modal", workflowId: id, topic: "Evaporation", subject: null, mode: "fresh", sessionId: null, teachingMode: "learn_with_guide" });
    // Taught once (its session row saved): resume reopens that row as a continuation.
    await engine.transition(id, { from: "scheduled", to: "teaching_active" });
    await engine.annotate(id, { adaptiveSessionId: "00000000-0000-4000-8000-000000000001" });
    const again = await call("ada", "POST", `/${id}/resume`);
    assert.deepEqual([again.body.open.mode, again.body.open.sessionId], ["continuation", "00000000-0000-4000-8000-000000000001"]);
    assert.equal((await call("bob", "POST", `/${id}/resume`)).status, 404);
    await engine.transition(id, { from: "teaching_active", to: "assessment" });
    await engine.transition(id, { from: "assessment", to: "completed" });
    assert.equal((await call("ada", "POST", `/${id}/resume`)).status, 409);
  });
});

test("the dashboard routes a direct session to the teaching modal with its workflowId", async (t) => {
  await withServer(t, async ({ call, engine }) => {
    const { body } = await call("ada", "POST", "", { topic: "Evaporation", subject: "Basic Science" });
    const d = describeWorkflow(await engine.get(body.workflowId));
    assert.equal(d.action.route.surface, "teaching_modal");
    assert.equal(d.action.route.workflowId, body.workflowId);
    assert.equal(d.badge.label, "Ready");
  });
});

test("workflows switched off: 503, nothing made", async (t) => {
  await withServer(t, async ({ call }) => {
    const r = await call("ada", "POST", "", { topic: "Evaporation" });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "workflows_off");
  }, { enabled: () => false });
});

test("app.js mounts it; the learner app creates the workflow before the modal opens", () => {
  const app = readFileSync(new URL("../../../app.js", import.meta.url), "utf8");
  assert.match(app, /app\.use\("\/api\/teaching\/workflows", standardLimit, teachingWorkflowsModule\);/);
  const dash = readFileSync(new URL("../../../../akoro-learner/src/pages/LearnerDashboard.jsx", import.meta.url), "utf8");
  assert.match(dash, /apiPost\('\/api\/teaching\/workflows'/);
});
