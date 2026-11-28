// Seam tests for teaching-workflow/runner.js + tools.js: the full 8-step
// adaptive teaching turn driven through executeTeachingTurnWorkflow with STUB
// collaborators (student agent, guide) — no LLM, no network. edu.student_states
// goes to the in-memory db fake; student-state.js's Redis client is closed at
// once and replaced by an in-memory map so the process exits on its own.
import assert from "node:assert/strict";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { TEACHING_TURN_WORKFLOW, executeTeachingTurnWorkflow } = await import("./runner.js");
const { createTeachingTurnTools, TEACHING_TURN_TOOL_CATALOG } = await import("./tools.js");
const { STUDENT_PHASES, ACTION_FOR_DIALOGUE_MOVE, applyTeachingProgress } = await import("../teaching-session/state-machine.js");
const { createTeachingEvidenceState, applyTeachingObservation } = await import("../learner/teaching-evidence.js");

const { installFakeDb } = await import("../../../lib/testing/fakeDb.mjs");

async function setupTeachingSeam() {
  delete process.env.REDIS_URL;
  const { default: db } = await import("../../../db.js");
  const studentState = await import("../../learner-state/index.js");

  // student-state.js always constructs an ioredis client (defaulting to
  // localhost:6379, retrying with maxRetriesPerRequest:null → commands would
  // queue). Close the socket immediately and serve the cache from memory.
  const silence = { warn: console.warn, log: console.log, error: console.error };
  console.warn = () => {}; console.log = () => {}; console.error = () => {};
  const redis = studentState.getRedis();
  redis.disconnect();
  Object.assign(console, silence);
  const cache = new Map();
  const redisOps = [];
  redis.get = async (k) => { redisOps.push(["get", k]); return cache.get(k) ?? null; };
  redis.setex = async (k, _ttl, v) => { redisOps.push(["setex", k]); cache.set(k, v); return "OK"; };
  redis.del = async (k) => { redisOps.push(["del", k]); cache.delete(k); return 1; };

  return {
    db, studentState, cache, redisOps,
    install(seed = {}) { cache.clear(); redisOps.length = 0; return installFakeDb(db, seed); },
  };
}

/** A strong observation: verified mastery for the active concept. The
 *  learned chunk is what the judge names in the same output (cost work,
 *  2026-11-28) — the record step files it without a second model call. */
const STRONG = {
  coreExplanation: 1, application: 1, reasoning: 0.8,
  learned: { content: "Light reactions convert light energy into ATP and NADPH in the thylakoid membrane.", chunkType: "taught", confidence: 0.8 },
};
/** A weak observation: core explanation still emerging. */
const WEAK = { coreExplanation: 0.25 };

/**
 * An orchestrator-shaped stub. `log` records every collaborator call in order.
 * Pass `observation` (object or thrower), `guideResult`, `mustKnowParts`, etc.
 */
function makeOrchestrator({
  log = [],
  observation = WEAK,
  guideResult = { tip: "Ask for an example", nextAction: "DIG_DEEPER", nextPhase: null },
  mustKnowParts = ["light reactions", "calvin cycle"],
  mustKnowIndex = 0,
  phase = "PHASE_1",
  replyThrows = null,
  withGuide = true,
} = {}) {
  const studentAgent = {
    studentKnowledgeRefs: ["sk-1"],
    teacherChunksUsed: 2,
    async assessTeachingEvidence(args) {
      log.push(["assessTeachingEvidence", args]);
      if (observation instanceof Error) throw observation;
      return observation;
    },
    async reply(...args) {
      log.push(["reply", args]);
      if (replyThrows) throw replyThrows;
      args[5]?.("chunk");
      return "Oh! So light is captured by chlorophyll?";
    },
    async analyzeUnderstanding(...args) {
      log.push(["analyzeUnderstanding", args]);
      return { understanding: 90, confusion: 5, engagement: 80, newConceptLearned: "chlorophyll absorbs light", mistakes: [], strengths: ["clear"] };
    },
    recordLearnedChunk(...args) { log.push(["recordLearnedChunk", args]); return { id: "k-1" }; },
    async extractStudentKnowledge(...args) { log.push(["extractStudentKnowledge", args]); return null; },
  };
  return {
    studentId: "learner-1",
    studentAgentRecord: { id: "agent-1" },
    session: { topic: "Photosynthesis", phase, mustKnowParts, mustKnowIndex, history: [{ role: "user", content: "earlier" }] },
    decayPayload: { subject: "Biology" },
    studentAgent,
    guideOrchestrator: withGuide
      ? { guide: { async getTip(args, onChunk) { log.push(["getTip", args]); onChunk?.("tip"); return { ...guideResult }; } } }
      : {},
    stats: { agentKnowledgeAdded: 0, conceptsLearned: [], misconceptionsCleared: [] },
    getTeachingEvidenceSnapshot() { return { snapshot: true }; },
  };
}

// ─── tests ──────────────────────────────────────────────────────────────────

const seam = await setupTeachingSeam();
const STATES = "edu.student_states";
const STEPS = [
  "load_session_state", "observe_teaching_evidence", "generate_protege_discussion",
  "assess_protege_understanding", "persist_cognitive_state", "record_verified_learning",
  "coach_teaching_dialogue", "gate_teaching_progress",
];
const quietWarn = () => { const w = console.warn; console.warn = () => {}; return () => { console.warn = w; }; };

async function runTurn(orchestrator, { callbacks = {}, humanMessage = "Plants use light to make sugar." } = {}) {
  const events = [];
  const stateUpdates = [];
  const context = await executeTeachingTurnWorkflow({
    orchestrator,
    humanMessage,
    callbacks: {
      onWorkflowStep: (e) => events.push(e),
      onStateUpdate: (s) => stateUpdates.push(s),
      ...callbacks,
    },
    phaseLabels: STUDENT_PHASES,
    actionForDialogueMove: ACTION_FOR_DIALOGUE_MOVE,
  });
  return { context, events, stateUpdates };
}
const upserts = (fake) => fake.calls.filter((c) => c.table === STATES && c.op === "upsert").length;

/** One earlier scored attempt on the active part, so the turn under test is
 *  the second — a part verifies only after two scored messages (the
 *  2026-11-28 evidence rule), which the gate/MASTERY tests rely on. */
function seedPriorAttempt(orchestrator, observation) {
  const state = createTeachingEvidenceState({ conceptCount: orchestrator.session.mustKnowParts.length });
  orchestrator.teachingEvidence = applyTeachingObservation(state, 0, observation).state;
  return orchestrator;
}

test("the documented 8 steps are the workflow, in order, each with a public catalog label", () => {
  assert.deepEqual([...TEACHING_TURN_WORKFLOW.tools], STEPS);
  assert.deepEqual(Object.keys(createTeachingTurnTools()), STEPS);
  assert.deepEqual(TEACHING_TURN_TOOL_CATALOG.map((t) => t.name), STEPS);
});

test("a full turn runs all 8 steps in order with started/completed events and stub collaborators in step order", async () => {
  const fake = seam.install();
  const log = [];
  const orchestrator = makeOrchestrator({ log });
  const { context, events } = await runTurn(orchestrator);

  assert.deepEqual(context.completedTools, STEPS);
  assert.deepEqual(events.map((e) => [e.step, e.status]), STEPS.flatMap((s) => [[s, "started"], [s, "completed"]]));
  for (const e of events) {
    assert.equal(e.workflow, "adaptive_teaching_turn");
    assert.equal(e.policyVersion, "adaptive-teaching-workflow-v1");
    assert.equal(e.label, TEACHING_TURN_TOOL_CATALOG.find((t) => t.name === e.step).label);
    assert.deepEqual(Object.keys(e).sort(), ["label", "policyVersion", "status", "step", "workflow"], "no outputs / learner text cross the boundary");
  }
  // Steps 2,3,6,7 are the LLM-backed collaborators; they run in step order.
  // (Step 4 derives its read from the step-2 evidence — no collaborator call.)
  assert.deepEqual(log.map(([name]) => name), [
    "assessTeachingEvidence", "reply",
    "extractStudentKnowledge", "getTip",
  ]);
  assert.deepEqual(context.publicWorkflow, {
    type: "adaptive_teaching_turn", policyVersion: "adaptive-teaching-workflow-v1",
    state: "completed", completedTools: STEPS,
  });
  // Step 1 loaded state from the cold store (fake) — no Redis hit yet.
  assert.equal(context.state.agentId, "agent-1");
  assert.ok(fake.calls.some((c) => c.table === STATES && c.op === "select"));
  fake.restore();
});

test("collaborators receive the turn's context; callbacks and stats are updated", async () => {
  const fake = seam.install();
  const log = [];
  const studentChunks = []; const guideChunks = [];
  const orchestrator = seedPriorAttempt(makeOrchestrator({ log, observation: STRONG }), STRONG);
  const { context, stateUpdates } = await runTurn(orchestrator, {
    callbacks: { onStudentChunk: (c) => studentChunks.push(c), onGuideChunk: (c) => guideChunks.push(c) },
  });

  const assessArgs = log.find(([n]) => n === "assessTeachingEvidence")[1];
  assert.deepEqual(assessArgs, { humanMessage: "Plants use light to make sugar.", topic: "Photosynthesis", currentSubtopic: "light reactions", history: orchestrator.session.history, protegeLastMessage: null });
  const replyArgs = log.find(([n]) => n === "reply")[1];
  assert.equal(replyArgs[4], STUDENT_PHASES.PHASE_1);
  assert.equal(replyArgs[6].dialogue.canAdvance, true);
  assert.equal(replyArgs[6].evidence.masteryStatus, "verified");
  const recordArgs = log.find(([n]) => n === "recordLearnedChunk")[1];
  assert.equal(recordArgs[0].content, STRONG.learned.content, "the judge's own chunk is filed, no second call");
  assert.equal(recordArgs[1].subject, "Biology", "subject comes from decayPayload");
  assert.equal(recordArgs[1].concept, "light reactions", "filed under the concept this turn taught");
  assert.deepEqual(studentChunks, ["chunk"]);
  assert.deepEqual(guideChunks, ["tip"]);

  // The turn's understanding read IS the observed evidence (derived, capped by construction).
  assert.ok(context.analysis.understanding <= Math.round(context.evidenceUpdate.current.protegeUnderstanding * 100));
  assert.equal(stateUpdates.length, 1);
  assert.equal(stateUpdates[0].understanding, Math.round(context.updatedState.cognitive.understanding * 100));

  assert.equal(orchestrator.stats.agentKnowledgeAdded, 1);
  assert.deepEqual(orchestrator.stats.conceptsLearned, ["light reactions"], "the verified part, named by the evidence-derived analysis");
  assert.deepEqual(orchestrator.stats.studentKnowledgeRefs, ["sk-1"]);
  assert.equal(orchestrator.stats.teacherChunksUsed, 2);
  assert.equal(orchestrator.teachingEvidence.concepts.length, 2);
  assert.equal(orchestrator.session.teachingEvidence, orchestrator.teachingEvidence);
  fake.restore();
});

test("an evaluator failure in step 2 records notChecked (no evidence) and the turn still completes without advancing", async () => {
  const fake = seam.install();
  const restore = quietWarn();
  const orchestrator = makeOrchestrator({
    observation: new Error("evaluator LLM unavailable"),
    // The guide asks for a phase jump; without evidence it must not apply.
    guideResult: { tip: "move on", nextAction: "NEXT_SUBTOPIC", nextPhase: "PHASE_3" },
  });
  const { context, events } = await runTurn(orchestrator);
  restore();

  assert.deepEqual(context.completedTools, STEPS, "the turn continues past the failed evaluator");
  assert.ok(!events.some((e) => e.status === "failed"));
  assert.equal(context.evidenceUpdate.observation.coreExplanation, 0);
  assert.equal(context.evidenceUpdate.current.attempts, 0, "notChecked is not counted as an attempt");
  assert.equal(context.evidenceUpdate.current.masteryStatus, "introduced");
  assert.equal(context.evidenceUpdate.dialogue.canAdvance, false);
  assert.equal(orchestrator.session.phase, "PHASE_1");
  assert.equal(orchestrator.session.mustKnowIndex, 0);
  assert.equal(context.phaseChanged, false);
  assert.equal(context.subtopicAdvanced, false);
  assert.equal(context.guideResult.nextAction, "DIG_DEEPER");
  assert.deepEqual(orchestrator.stats.conceptsLearned, []);
  fake.restore();
});

test("phase/subtopic change exactly as applyTeachingProgress decides (guide request honoured only with evidence)", async () => {
  const fake = seam.install();
  const orchestrator = seedPriorAttempt(makeOrchestrator({ observation: STRONG, guideResult: { tip: "t", nextAction: "X", nextPhase: "PHASE_3" } }), STRONG);
  const { context } = await runTurn(orchestrator);

  const expected = applyTeachingProgress({
    phase: "PHASE_1", mustKnowIndex: 0, mustKnowCount: 2,
    canAdvance: true, allConceptsVerified: false, requestedPhase: "PHASE_3",
    dialogueMove: context.evidenceUpdate.dialogue.move,
  });
  assert.equal(orchestrator.session.phase, expected.phase);
  assert.equal(orchestrator.session.phase, "PHASE_3");
  assert.equal(orchestrator.session.mustKnowIndex, expected.mustKnowIndex);
  assert.equal(orchestrator.session.mustKnowIndex, 1);
  assert.equal(context.phaseChanged, true);
  assert.equal(context.phaseLabel, STUDENT_PHASES.PHASE_3);
  assert.equal(context.subtopicAdvanced, true);
  assert.equal(context.guideResult.nextAction, expected.nextAction);
  assert.equal(context.guideResult.nextMustKnowIndex, 1);
  // The persisted state reflects the gated position, not the guide's request alone.
  const saved = fake.rows(STATES)[0].state;
  assert.equal(saved.session.phase, "PHASE_3");
  assert.equal(saved.session.mustKnowIndex, 1);
  assert.equal(saved.session.lastAction, "NEXT_SUBTOPIC");
  fake.restore();
});

test("a guide-requested unknown phase or MASTERY never changes the phase; weak evidence never advances", async () => {
  for (const nextPhase of ["PHASE_9", "MASTERY", "__proto__"]) {
    const fake = seam.install();
    const orchestrator = makeOrchestrator({ observation: WEAK, guideResult: { tip: "t", nextAction: "GAP_CLOSED", nextPhase } });
    const { context } = await runTurn(orchestrator);
    assert.equal(orchestrator.session.phase, "PHASE_1", nextPhase);
    assert.equal(orchestrator.session.mustKnowIndex, 0);
    assert.equal(context.phaseChanged, false);
    assert.equal(context.guideResult.nextAction, ACTION_FOR_DIALOGUE_MOVE[context.evidenceUpdate.dialogue.move]);
    fake.restore();
  }
  // Even with strong evidence, MASTERY cannot be *requested* while concepts remain.
  const fake = seam.install();
  const orchestrator = makeOrchestrator({ observation: STRONG, guideResult: { nextPhase: "MASTERY" } });
  await runTurn(orchestrator);
  assert.notEqual(orchestrator.session.phase, "MASTERY");
  fake.restore();
});

test("the last concept verified enters MASTERY through the gate", async () => {
  const fake = seam.install();
  const orchestrator = seedPriorAttempt(makeOrchestrator({ observation: STRONG, mustKnowParts: ["only concept"], phase: "PHASE_4" }), STRONG);
  const { context } = await runTurn(orchestrator);
  assert.equal(orchestrator.session.phase, "MASTERY");
  assert.equal(context.phaseLabel, STUDENT_PHASES.MASTERY);
  assert.equal(context.guideResult.nextPhase, "MASTERY");
  assert.equal(context.guideResult.nextAction, "MASTERY");
  fake.restore();
});

test("no guide available → coach step falls back to DIG_DEEPER and the gate still runs", async () => {
  const fake = seam.install();
  const orchestrator = makeOrchestrator({ withGuide: false });
  const { context } = await runTurn(orchestrator);
  assert.deepEqual(context.completedTools, STEPS);
  assert.equal(context.guideResult.tip, null);
  assert.equal(orchestrator.session.phase, "PHASE_1");
  fake.restore();
});

test("student state is persisted TWICE per turn (current behaviour)", async () => {
  // MIGRATION_MATRIX §3.2: updateStudentState runs in persist_cognitive_state
  // (tools.js:108) AND again in gate_teaching_progress (tools.js:224), and it
  // is not idempotent — each call bumps turnCount and appends a history point.
  // So one learner turn = 2 upserts, turnCount += 2, history += 2. This test
  // pins the current count so the planned split (fixed steps vs agent tools)
  // changes it deliberately, not by accident.
  const fake = seam.install();
  const orchestrator = makeOrchestrator({ observation: STRONG });
  await runTurn(orchestrator);
  assert.equal(upserts(fake), 2);
  let saved = fake.rows(STATES)[0].state;
  assert.equal(fake.rows(STATES).length, 1, "upserted on agent_id");
  assert.equal(saved.session.turnCount, 2);
  assert.equal(saved.history.length, 2);
  assert.equal(seam.redisOps.filter(([op]) => op === "setex").length, 2);

  await runTurn(orchestrator, { humanMessage: "And the Calvin cycle fixes CO2." });
  assert.equal(upserts(fake), 4);
  saved = fake.rows(STATES)[0].state;
  assert.equal(saved.session.turnCount, 4, "two learner turns read as four");
  assert.equal(saved.history.length, 4);
  fake.restore();
});

test("a failing step emits 'failed', stops the sequence (gate never runs) and persists no state", async () => {
  const fake = seam.install();
  const orchestrator = makeOrchestrator({ replyThrows: new Error("protege LLM down") });
  const events = [];
  await assert.rejects(
    () => executeTeachingTurnWorkflow({
      orchestrator, humanMessage: "x", callbacks: { onWorkflowStep: (e) => events.push(e) },
      phaseLabels: STUDENT_PHASES, actionForDialogueMove: ACTION_FOR_DIALOGUE_MOVE,
    }),
    /protege LLM down/,
  );
  assert.deepEqual(events.map((e) => `${e.step}:${e.status}`), [
    "load_session_state:started", "load_session_state:completed",
    "observe_teaching_evidence:started", "observe_teaching_evidence:completed",
    "generate_protege_discussion:started", "generate_protege_discussion:failed",
  ]);
  assert.equal(upserts(fake), 0);
  assert.equal(orchestrator.session.phase, "PHASE_1");
  fake.restore();
});

test("an uninitialised session is refused before any step runs", async () => {
  const fake = seam.install();
  for (const broken of [
    { ...makeOrchestrator(), studentAgent: null },
    { ...makeOrchestrator(), studentAgentRecord: null },
    { ...makeOrchestrator(), session: { phase: "PHASE_1" } },
    null,
  ]) {
    const events = [];
    await assert.rejects(
      () => executeTeachingTurnWorkflow({ orchestrator: broken, humanMessage: "x", callbacks: { onWorkflowStep: (e) => events.push(e) }, phaseLabels: STUDENT_PHASES }),
      /requires an initialized session/,
    );
    assert.equal(events.length, 0);
  }
  assert.equal(fake.calls.length, 0);
  fake.restore();
});
