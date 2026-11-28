/**
 * Phase 6 (§9.3): the agent-driven teaching turn. The agent picks the reply's move; the harness's
 * evidence pre-steps and the gate always run; anything invalid, slow or missing falls back to the
 * evidence's default move; completion is accepted only when every part is verified.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
process.env.SUPABASE_SERVICE_KEY ||= "test";
process.env.OPENAI_API_KEY ||= "test";

const { executeAgentTeachingTurn, controllerTools } = await import("./controller.js");
const { validateDecision, fallbackReply, boundedEnd, objectiveMet, TEACHING_POLICY } = await import("./policy.js");

/** A session and harness tools that record what ran, with the evidence the test sets. */
function setup({ dialogue = { move: "clarify_core", canAdvance: false, allConceptsVerified: false }, phase = "PHASE_2", mode } = {}) {
  const ran = [];
  const replies = [];
  const orchestrator = {
    studentId: "L1",
    session: { topic: "Osmosis", phase, mustKnowParts: ["Why water moves", "Plasmolysis"], mustKnowIndex: 0, history: [], turnCount: 1, teachingMode: mode },
    studentAgentRecord: { id: "agent-1" },
    stats: { conceptsLearned: [], misconceptionsCleared: [] },
    studentAgent: {
      reply: async (msg, topic, cog, hist, phaseLabel, onChunk, ctx) => { replies.push({ who: "protege", move: ctx.protegeMove }); return "Wait, why does water move that way?"; },
      extractStudentKnowledge: async () => null,
    },
  };
  const tool = (name, fn = () => {}) => ({ async execute(c) { ran.push(name); await fn(c); } });
  const tools = {
    load_session_state: tool("load_session_state", (c) => { c.state = { cognitive: { understanding: 0.4, confusion: 0.3, engagement: 0.6 } }; }),
    observe_teaching_evidence: tool("observe_teaching_evidence", (c) => { c.evidenceUpdate = { dialogue, current: { masteryStatus: "partial", learnerMastery: 0.5 }, misconceptionRepaired: false }; }),
    assess_protege_understanding: tool("assess_protege_understanding", (c) => { c.analysis = {}; }),
    persist_cognitive_state: tool("persist_cognitive_state"),
    record_verified_learning: tool("record_verified_learning"),
    coach_teaching_dialogue: tool("coach_teaching_dialogue", (c) => { c.guideResult = { tip: null, nextAction: "DIG_DEEPER" }; }),
    gate_teaching_progress: tool("gate_teaching_progress"),
  };
  const teachGuide = async ({ move }) => { replies.push({ who: "guide", move }); return "Think of a sponge…"; };
  return { orchestrator, tools, teachGuide, ran, replies };
}
const run = (s, decide, extra = {}) => executeAgentTeachingTurn({ orchestrator: s.orchestrator, humanMessage: "Water moves from more water to less water.", phaseLabels: { PHASE_2: "Must-know parts", MASTERY: "Mastery" }, actionForDialogueMove: { clarify_core: "DIG_DEEPER" }, decide, tools: s.tools, teachGuide: s.teachGuide, ...extra });

test("the agent picks the protégé's move; pre-steps and the gate always run", async () => {
  const s = setup();
  const picks = [{ tool: "teaching_get_state", args: {} }, { tool: "protege_respond", args: { move: "challenge", focusConcept: "Why water moves" } }];
  const ctx = await run(s, async () => picks.shift());
  assert.deepEqual(s.ran.slice(0, 2), ["load_session_state", "observe_teaching_evidence"]);
  assert.ok(s.ran.includes("gate_teaching_progress") && s.ran.includes("persist_cognitive_state"));
  assert.equal(ctx.reply.tool, "protege.respond");
  assert.equal(ctx.reply.move, "challenge");
  assert.match(s.replies[0].move, /but what if/);
  assert.equal(ctx.fallback, null);
  assert.deepEqual(ctx.decisions.map((d) => d.tool), ["teaching.get_state", "protege.respond"]);
});

test("invalid, slow or missing decisions fall back to the evidence's default move", async () => {
  let s = setup({ dialogue: { move: "repair_misconception" } });
  let ctx = await run(s, async () => ({ tool: "guide_teach", args: { move: "explain" } }));   // not permitted in teach mode
  assert.equal(ctx.reply.move, "confused_student");
  assert.equal(ctx.decisions[0].error, "tool_not_permitted");
  assert.equal(ctx.fallback.reason, "tool_not_permitted");
  s = setup();
  ctx = await run(s, () => new Promise(() => {}), { policy: { ...TEACHING_POLICY, DECISION_TIMEOUT_MS: 30 } });
  assert.equal(ctx.fallback.reason, "timeout");
  assert.equal(s.replies.length, 1, "exactly one reply");
  s = setup();
  ctx = await run(s, async () => { throw new Error("model down"); });
  assert.equal(ctx.fallback.reason, "model_error");
  assert.ok(s.ran.includes("gate_teaching_progress"), "the gate runs whatever the agent did");
});

test("completion only when every part is verified; otherwise objective_not_met and the agent replies", async () => {
  let s = setup();
  const picks = [{ tool: "teaching_propose_complete", args: {} }, { tool: "protege_respond", args: { move: "ask_followup" } }];
  let ctx = await run(s, async () => picks.shift());
  assert.equal(ctx.completeAccepted, undefined);
  assert.equal(ctx.decisions.length, 2);
  assert.equal(ctx.endRequested, null);
  s = setup({ dialogue: { move: "synthesise", canAdvance: true, allConceptsVerified: true }, phase: "MASTERY" });
  ctx = await run(s, async () => ({ tool: "teaching_propose_complete", args: {} }));
  assert.equal(ctx.completeAccepted, true);
  assert.equal(ctx.endRequested, "objective_met");
  assert.equal(ctx.reply.move, "acknowledge");
});

test("guide mode: NaNa replies, the protégé is never called, and its tools are refused", async () => {
  const s = setup({ mode: "learn_with_guide" });
  const picks = [{ tool: "protege_respond", args: { move: "challenge" } }, { tool: "guide_teach", args: { move: "use_analogy" } }];
  const ctx = await run(s, async () => picks.shift());
  assert.equal(ctx.mode, "learn_with_guide");
  assert.equal(ctx.decisions[0].error, "tool_not_permitted");
  assert.deepEqual(s.replies, [{ who: "guide", move: "use_analogy" }]);
  assert.equal(ctx.guideReply, "Think of a sponge…");
  assert.ok(!s.ran.includes("assess_protege_understanding") && !s.ran.includes("coach_teaching_dialogue"));
  assert.ok(s.ran.includes("gate_teaching_progress"));
  assert.ok(!controllerTools("learn_with_guide").some((t) => t.function.name === "protege_respond"));
});

test("merged decide+reply: one persona call picks the move; the controller is never called", async () => {
  const s = setup();
  s.orchestrator.studentAgent.reply = async (msg, topic, cog, hist, phaseLabel, onChunk, ctx) => {
    assert.ok(ctx.mergedMove, "the merged protocol is offered to the persona call");
    assert.equal(ctx.mergedMove.defaultMove, "request_clarification", "the evidence's default move rides along");
    ctx.mergedMove.onMove("challenge");
    return "Wait, why does water move that way?";
  };
  const ctx = await run(s, async () => { throw new Error("decide must not be called on the merged path"); }, { mergeReply: true });
  assert.equal(ctx.reply.tool, "protege.respond");
  assert.equal(ctx.reply.move, "challenge");
  assert.deepEqual(ctx.decisions.map((d) => [d.tool, d.merged]), [["protege_respond", true]]);
  assert.ok(s.ran.includes("gate_teaching_progress"), "the gate still runs");
});

test("merged path: no move reported → the evidence's default move stands", async () => {
  const s = setup({ dialogue: { move: "repair_misconception", canAdvance: false, allConceptsVerified: false } });
  s.orchestrator.studentAgent.reply = async () => "Hmm, I thought it was the other way round.";
  const ctx = await run(s, async () => null, { mergeReply: true });
  assert.equal(ctx.reply.move, "confused_student");
});

test("policy: strategy cap, bounded end, fallback table", () => {
  assert.equal(validateDecision("teach_agent", { tool: "strategy_select", args: { strategy: "contrast_pairs" } }, { strategyChanges: 2 }).error, "strategy_cap_reached");
  // Strategy Library v3: in-session strategies only; unknown names are invalid, harness ones not permitted mid-session.
  assert.equal(validateDecision("teach_agent", { tool: "strategy_select", args: { strategy: "socratic" } }).error, "invalid_arguments");
  assert.equal(validateDecision("teach_agent", { tool: "strategy_select", args: { strategy: "chunk_plan" } }).error, "invalid_arguments");
  assert.equal(validateDecision("teach_agent", { tool: "strategy_select", args: { strategy: "worked_example" } }).ok, true, "the pre-v3 name maps to worked_examples");
  assert.equal(boundedEnd({ turnCount: 60 }), "turn_cap");
  assert.equal(boundedEnd({ turnCount: 10 }), null);
  assert.deepEqual(fallbackReply("learn_with_guide", "repair_misconception"), { tool: "guide_teach", args: { move: "correct_misconception" } });
  assert.equal(objectiveMet({ phase: "MASTERY", allConceptsVerified: false }), false);
});
