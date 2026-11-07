/**
 * Phase 7 open item: teaching.request_assessment — a short Agent Check
 * mid-session (teach_agent only). NaNa asks, the protégé answers from what it
 * was taught (persona, the learner's pick), Sergeant judges (assessor, locked);
 * a guess never counts; it ends the turn with a card and the protégé's line; at
 * most MAX_ASSESSMENTS per session; the gate still runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { assessmentConcepts, teachingNotes, scoreAssessment, protegeLine, runTeachingAssessment } = await import("./assessment.js");
const { executeAgentTeachingTurn, controllerTools } = await import("./controller.js");
const { validateDecision, TOOLS_BY_MODE, TEACHING_POLICY, PLAN_NAME } = await import("./policy.js");

test("pure: which parts are checked, the notes, the score, the protégé's line", () => {
  const parts = ["Why water moves", "Plasmolysis", "Turgor"];
  assert.deepEqual(assessmentConcepts({ parts, index: 1 }), ["Why water moves", "Plasmolysis"], "the parts taught so far");
  assert.deepEqual(assessmentConcepts({ parts, index: 1, requested: ["plasmolysis", "Turgor"] }), ["Plasmolysis"], "asked-for parts only when taught");
  assert.deepEqual(assessmentConcepts({ parts, index: 0, requested: ["made up"] }), ["Why water moves"]);
  assert.deepEqual(teachingNotes([{ role: "human_teacher", content: " Water  moves " }, { role: "student_agent", content: "ok" }]), ["Water moves"]);
  assert.deepEqual(scoreAssessment([{ outcome: "correct" }, { outcome: "guessed_right" }]), { correct: 1, total: 2, outcome: "partial" });
  assert.equal(scoreAssessment([{ outcome: "correct" }]).outcome, "passed");
  assert.match(protegeLine({ correct: 1, total: 2, items: [{ concept: "A", outcome: "correct" }, { concept: "Plasmolysis", outcome: "wrong" }] }), /1 of 2.*plasmolysis/);
});

test("the check: NaNa and Sergeant on the locked assessor role, the protégé on the persona role with the pick, answering from the notes", async () => {
  const calls = [];
  const complete = async (params) => {
    calls.push(params);
    if (calls.length === 1) return JSON.stringify({ questions: [{ question: "Why does water move into a cell?" }, { question: "What is plasmolysis?" }] });
    if (calls.length === 2) return JSON.stringify({ answers: [{ answer: "By osmosis, to where there is less water.", fromNotes: true }, { answer: "Maybe it bursts?", fromNotes: false }] });
    return JSON.stringify({ verdicts: [{ correct: true }, { correct: true }] });
  };
  const orchestrator = { studentId: "L1", session: { topic: "Osmosis", history: [{ role: "human_teacher", content: "Water moves by osmosis from more water to less." }] } };
  const r = await runTeachingAssessment({ orchestrator, concepts: ["Why water moves", "Plasmolysis"], modelPick: { __learnerChoice: "claude-sonnet" }, complete });
  assert.deepEqual(calls.map((c) => c.__role), ["assessor", "persona", "assessor"]);
  assert.equal(calls[0].__learnerChoice, undefined, "the question writer never gets the pick");
  assert.equal(calls[2].__learnerChoice, undefined, "the judge never gets the pick");
  assert.equal(calls[1].__learnerChoice, "claude-sonnet", "the protégé does");
  assert.ok(JSON.parse(calls[1].messages[1].content).notes[0].includes("osmosis"), "it answers from what it was taught");
  assert.deepEqual(r.items.map((i) => i.outcome), ["correct", "guessed_right"], "a right guess doesn't count");
  assert.deepEqual([r.correct, r.total, r.outcome], [1, 2, "partial"]);
  assert.ok(calls.every((c) => c.__userId === "L1" && c.__feature === "teaching_assessment"), "billed to the learner under its own feature");
});

test("a malformed model answer is a miss, never a crash", async () => {
  const r = await runTeachingAssessment({ orchestrator: { session: { history: [] } }, concepts: ["X"], complete: async () => "not json" });
  assert.equal(r.items[0].outcome, "guessed");
  assert.equal(r.correct, 0);
});

test("policy: teach_agent only, capped per session, conceptIds must be a list", () => {
  assert.ok(TOOLS_BY_MODE.teach_agent.includes("teaching_request_assessment"));
  assert.ok(!TOOLS_BY_MODE.learn_with_guide.includes("teaching_request_assessment"));
  assert.equal(PLAN_NAME.teaching_request_assessment, "teaching.request_assessment");
  assert.ok(controllerTools("teach_agent").some((t) => t.function.name === "teaching_request_assessment"));
  assert.equal(validateDecision("learn_with_guide", { tool: "teaching_request_assessment" }).error, "tool_not_permitted");
  assert.equal(validateDecision("teach_agent", { tool: "teaching_request_assessment", args: { conceptIds: "x" } }).error, "invalid_arguments");
  assert.equal(validateDecision("teach_agent", { tool: "teaching_request_assessment" }, { assessments: TEACHING_POLICY.MAX_ASSESSMENTS }).error, "assessment_cap_reached");
  assert.equal(validateDecision("teach_agent", { tool: "teaching_request_assessment" }, { taughtTurns: 1 }).error, "nothing_taught_yet", "not before two messages taught");
  assert.equal(validateDecision("teach_agent", { tool: "teaching_request_assessment", args: { conceptIds: ["A"] } }).ok, true);
});

function setup() {
  const ran = [];
  const orchestrator = {
    studentId: "L1",
    session: { topic: "Osmosis", phase: "PHASE_2", mustKnowParts: ["Why water moves", "Plasmolysis"], mustKnowIndex: 0, turnCount: 3, teachingMode: "teach_agent",
      history: [{ role: "human_teacher", content: "Cells have a membrane." }, { role: "student_agent", content: "Ok" }, { role: "human_teacher", content: "Water crosses it." }] },
    studentAgentRecord: { id: "a1" }, stats: { conceptsLearned: [], misconceptionsCleared: [] },
    studentAgent: { reply: async () => { ran.push("protege_reply"); return "Why?"; }, extractStudentKnowledge: async () => null },
  };
  const tool = (name, fn = () => {}) => ({ async execute(c) { ran.push(name); await fn(c); } });
  const tools = {
    load_session_state: tool("load_session_state", (c) => { c.state = { cognitive: { understanding: 0.4, confusion: 0.3, engagement: 0.6 } }; }),
    observe_teaching_evidence: tool("observe_teaching_evidence", (c) => { c.evidenceUpdate = { dialogue: { move: "clarify_core" }, current: {}, misconceptionRepaired: false }; }),
    assess_protege_understanding: tool("assess_protege_understanding", (c) => { c.analysis = {}; }), persist_cognitive_state: tool("persist_cognitive_state"),
    record_verified_learning: tool("record_verified_learning"), coach_teaching_dialogue: tool("coach_teaching_dialogue", (c) => { c.guideResult = { nextAction: "DIG_DEEPER" }; }),
    gate_teaching_progress: tool("gate_teaching_progress"),
  };
  return { orchestrator, tools, ran };
}

test("in a turn: it ends the turn with the card and the protégé's line; the gate still runs; the third is refused", async () => {
  const s = setup();
  const seen = [];
  const assess = async ({ concepts, orchestrator, modelPick }) => {
    seen.push({ concepts, notes: orchestrator.session.history.map((h) => h.content), modelPick });
    return { concepts, items: [{ concept: concepts[0], outcome: "correct" }], correct: 1, total: 1, outcome: "passed" };
  };
  const turn = (decide) => executeAgentTeachingTurn({ orchestrator: s.orchestrator, humanMessage: "Water moves by osmosis.", phaseLabels: {}, actionForDialogueMove: {}, tools: s.tools, decide, assess, pickFor: async () => ({ __learnerChoice: "claude-sonnet" }) });
  const ctx = await turn(async () => ({ tool: "teaching_request_assessment", args: {} }));
  assert.equal(ctx.reply.tool, "teaching.request_assessment");
  assert.deepEqual(seen[0].concepts, ["Why water moves"]);
  assert.deepEqual(seen[0].notes, ["Cells have a membrane.", "Ok", "Water crosses it.", "Water moves by osmosis."], "this turn's teaching counts too");
  assert.equal(seen[0].modelPick.__learnerChoice, "claude-sonnet");
  assert.deepEqual([ctx.assessment.correct, ctx.assessment.total, ctx.assessment.number], [1, 1, 1]);
  assert.match(ctx.studentReply, /all 1 right/);
  assert.ok(!s.ran.includes("protege_reply"), "the check IS the reply — no second protégé reply");
  assert.ok(s.ran.includes("gate_teaching_progress"), "the gate still runs");
  assert.equal(ctx.publicWorkflow.assessment.outcome, "passed");

  await turn(async () => ({ tool: "teaching_request_assessment", args: {} }));
  const third = await turn(async ({ iteration }) => (iteration === 1 ? { tool: "teaching_request_assessment", args: {} } : { tool: "protege_respond", args: { move: "acknowledge" } }));
  assert.equal(third.decisions[0].error, "assessment_cap_reached");
  assert.equal(third.reply.tool, "protege.respond");
  assert.equal(seen.length, 2);
});

test("a check that fails to run still gives the learner a reply", async () => {
  const s = setup();
  const ctx = await executeAgentTeachingTurn({ orchestrator: s.orchestrator, humanMessage: "x", phaseLabels: {}, actionForDialogueMove: {}, tools: s.tools,
    decide: async () => ({ tool: "teaching_request_assessment", args: {} }), assess: async () => { throw new Error("down"); }, pickFor: null });
  assert.equal(ctx.assessment.outcome, "unavailable");
  assert.match(ctx.studentReply, /couldn't take the check/);
});
