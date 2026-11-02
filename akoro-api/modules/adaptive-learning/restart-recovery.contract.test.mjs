/**
 * Phase 18 item 5 — the restart note: a workflow step interrupted by a deploy
 * resumes with a check of what already happened before repeating an outside
 * action (a check battle made, a teaching session row created).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";

const { createWorkflowEngine } = await import("../workflows/engine.js");
const { memoryWorkflowStore } = await import("../workflows/store.js");
await import("./decay-review/workflow.js");
const { makeDecayReview, isStalledInspect, STALLED_MS } = await import("./decay-review/service.js");
const { stalledApproval, STALLED_APPROVAL_MS } = await import("./study-prep/teaching-handoff.js");
const { makeOutbox, memoryRepo } = await import("../../lib/outboxEngine.js");

const L = "learner-1";

test("a decay review cut off between 'inspect' and its check resumes on the next tap — one battle, keyed to the step", async () => {
  const store = memoryWorkflowStore();
  const engine = createWorkflowEngine({ store, publish: () => {} });
  const battles = [];
  const box = makeOutbox({ repo: memoryRepo(), channels: new Map(), schedule: () => {}, log: { warn() {} } });
  let crash = true;
  const svc = makeDecayReview({
    engine, log: { warn() {} },
    decay: { session: async () => ({ subject: "Biology", concepts: [] }), reinforce: async () => ({}), markRead: async () => false, markActioned: async () => {} },
    checks: {
      // The wiring's shape: a journaled step per actionKey, the battle found again after an interruption.
      start: async ({ actionKey, title }) => (await box.outsideAction({
        kind: "decay_check", key: actionKey,
        // The first run makes its battle and then the process "dies": the step never finishes.
        act: async () => { battles.push({ id: `b${battles.length + 1}`, title }); if (crash) { crash = false; return new Promise(() => {}); } return { battleId: battles.at(-1).id }; },
        check: async () => (battles.length ? { battleId: battles.at(-1).id } : null),
      })).result,
      results: async () => ({ score: 1, total: 3, correct: 3, gaps: [], perQuestion: [] }),
    },
    recall: { question: async () => null, judge: async () => null },
    agentOf: async () => "agent-1",
    findByBattle: async () => null,
  });
  // The first tap dies after making the battle (as a deploy would, before the step is recorded as done).
  svc.start({ learnerId: L, topic: "Osmosis", subject: "Biology" });
  for (let i = 0; i < 50 && !battles.length; i++) await new Promise((r) => setImmediate(r));
  assert.equal(battles.length, 1);
  const [stuck] = await store.listInstances(L);
  assert.equal(stuck.state, "inspecting");
  assert.equal(isStalledInspect(stuck), false, "not before a minute has passed");
  assert.equal(isStalledInspect(stuck, Date.parse(stuck.updated_at || stuck.created_at) + STALLED_MS), true);
  // A minute later the learner taps Review again: the step resumes.
  const realNow = Date.now;
  Date.now = () => realNow() + Math.max(STALLED_MS, 120_000) + 1000;
  try {
    const v = await svc.start({ learnerId: L, topic: "Osmosis", subject: "Biology" });
    assert.equal(v.state, "diagnostic");
    assert.equal(v.workflowId, stuck.id, "the same review, not a second one");
    assert.equal(v.check?.battleId ?? (await store.listInstances(L))[0].metadata.check.battleId, "b1", "the battle made before the crash");
  } finally { Date.now = realNow; }
  assert.equal(battles.length, 1, "checked first: no second battle");
  const again = await box.outsideAction({ kind: "decay_check", key: `decay_review:${stuck.id}:check`, act: async () => { battles.push({}); return {}; } });
  assert.equal(again.reused, true, "a later tap reuses the step's battle");
  assert.equal(battles.length, 1);
});

test("a teaching approval cut off before its session row resumes; one made in time is left alone", () => {
  const at = Date.parse("2026-11-02T10:00:00Z");
  const child = { state: "scheduled", metadata: { approvedAt: new Date(at).toISOString() } };
  assert.equal(stalledApproval(child, at + 1000), false, "still in progress");
  assert.equal(stalledApproval(child, at + STALLED_APPROVAL_MS), true, "cut off: resumed by the next tap or the sweep");
  assert.equal(stalledApproval({ ...child, metadata: { ...child.metadata, adaptiveSessionId: "s1" } }, at + STALLED_APPROVAL_MS), false, "row made: nothing to repeat");
  assert.equal(stalledApproval({ ...child, state: "proposed" }, at + STALLED_APPROVAL_MS), false);
});
