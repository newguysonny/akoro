// Phase 10 — one next-action decision path (the Adaptive Learning Engine),
// scale guards at the learner-model boundary, and the retired session copies.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ACTION_FOR_DIALOGUE_MOVE, NEXT_ACTIONS, REVIEW_SPACING_MS,
  defaultTeachingAction, recommendNextAction, unitInterval,
} from "./adaptive-engine.js";
import { ACTION_FOR_DIALOGUE_MOVE as GATE_TABLE, applyTeachingProgress } from "./teaching-session/state-machine.js";
import { toUnitScore, toPercentScore, masteryWriteBack } from "./study-prep/education-engine.js";
import { applyCentralMisconceptions, applyTeachingObservation, createTeachingEvidenceState, DIALOGUE_MOVES } from "./learner/teaching-evidence.js";

process.env.SUPABASE_URL ||= "http://localhost:1";
process.env.SUPABASE_SERVICE_KEY ||= "test";
const { misconceptionTitles } = await import("./learner/learner-model.js");

const read = (f) => readFile(new URL(f, import.meta.url), "utf8");
const NOW = Date.parse("2026-11-06T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

test("teaching turn: the dialogue move decides — exactly the gate's old table lookup", () => {
  assert.equal(GATE_TABLE, ACTION_FOR_DIALOGUE_MOVE, "the gate re-exports the engine's table");
  assert.ok(Object.isFrozen(ACTION_FOR_DIALOGUE_MOVE));
  for (const [move, action] of Object.entries(ACTION_FOR_DIALOGUE_MOVE)) {
    const r = recommendNextAction({ dialogueMove: move });
    assert.deepEqual(r, { action, reason: `dialogue_move:${move}`, source: "teaching_evidence" });
    assert.ok(NEXT_ACTIONS.includes(action));
  }
  assert.equal(recommendNextAction({ dialogueMove: "made_up" }).action, "DIG_DEEPER");
  assert.equal(recommendNextAction({ dialogueMove: undefined }).action, "DIG_DEEPER", "a turn with no move → DIG_DEEPER, as before");
  assert.equal(defaultTeachingAction({ dialogueMove: "x", actionForDialogueMove: { x: "CHALLENGE" } }), "CHALLENGE", "an injected table is honoured");
});

test("the progression gate takes its next action from the engine (behaviour unchanged)", () => {
  const base = { phase: "PHASE_2", mustKnowIndex: 0, mustKnowCount: 3, allConceptsVerified: false, requestedPhase: null };
  for (const move of Object.values(DIALOGUE_MOVES)) {
    const held = applyTeachingProgress({ ...base, canAdvance: false, dialogueMove: move });
    assert.equal(held.nextAction, ACTION_FOR_DIALOGUE_MOVE[move]);
  }
  assert.equal(applyTeachingProgress({ ...base, canAdvance: true, dialogueMove: "clarify_core" }).nextAction, "NEXT_SUBTOPIC");
  assert.equal(applyTeachingProgress({ ...base, mustKnowIndex: 2, canAdvance: true, allConceptsVerified: true, dialogueMove: "synthesise" }).nextAction, "MASTERY");
  assert.equal(applyTeachingProgress({ ...base, canAdvance: false, dialogueMove: "nope" }).nextAction, "DIG_DEEPER");
});

test("learner model: the former decideNextAction rules, in order", () => {
  const at = (understanding, extra = {}) => recommendNextAction({
    cognitive: { understanding, confusion: extra.confusion ?? 0.2 }, hasHistory: extra.hasHistory ?? true,
    misconceptionActive: extra.misconceptionActive, lastReviewedAt: extra.lastReviewedAt ?? NOW, now: NOW,
  }).action;
  assert.equal(at(0.9, { misconceptionActive: true }), "CLEAR_MISTAKE", "an active misconception comes first");
  assert.equal(at(0.9, { hasHistory: false }), "DIG_DEEPER", "nothing known about the topic yet");
  assert.equal(at(0.3), "DIG_DEEPER");
  assert.equal(at(0.6, { confusion: 0.6 }), "USE_ANALOGY");
  assert.equal(at(0.5), "ONE_MORE_PUSH");
  assert.equal(at(0.7), "NEXT_SUBTOPIC");
  assert.equal(at(0.8), "NAME_IT");
  assert.equal(at(0.85), "NEXT_SUBTOPIC", "the 0.82–0.88 band");
  assert.equal(at(0.9), "GAP_CLOSED");
  assert.equal(at(0.95), "TRIGGER_RECALL");
  assert.equal(at(0.9, { lastReviewedAt: NOW - REVIEW_SPACING_MS.mid - 1 }), "SPACED_REVIEW");
  assert.equal(at(0.95, { lastReviewedAt: NOW - 2 * DAY }), "TRIGGER_RECALL", "high band waits three days");
  assert.equal(at(0.95, { lastReviewedAt: NOW - 4 * DAY }), "SPACED_REVIEW");
  assert.equal(recommendNextAction({ cognitive: { understanding: 0.9 }, hasHistory: true, now: NOW, lastReviewedAt: NOW }).source, "learner_model");
});

test("learner model: the misconception signal is the CENTRAL state, not a per-session array", () => {
  const state = { mastery: 0.8, misconception_active: true, last_evidence_at: new Date(NOW).toISOString() };
  const r = recommendNextAction({ conceptState: state, now: NOW });
  assert.deepEqual(r, { action: "CLEAR_MISTAKE", reason: "misconception_active", source: "learner_model" });
  assert.equal(recommendNextAction({ conceptState: { ...state, misconception_active: false }, now: NOW }).action, "NAME_IT");
  // A legacy `mistakes` array is no longer an input.
  assert.equal(recommendNextAction({ cognitive: { understanding: 0.7 }, knowledge: { mistakes: ["x"] }, hasHistory: true, now: NOW, lastReviewedAt: NOW }).action, "NEXT_SUBTOPIC");
});

test("scale guards: 0–1 vs 0–100 at the learner-model boundary", () => {
  // Read side (engine inputs): a percentage is converted, never clamped to 1.
  assert.equal(unitInterval(0.42), 0.42);
  assert.equal(unitInterval(42), 0.42);
  assert.equal(unitInterval(1), 1);
  assert.equal(unitInterval(250), null);
  assert.equal(unitInterval(-1), null);
  assert.equal(unitInterval("abc"), null);
  assert.equal(unitInterval(null), null);
  const pct = recommendNextAction({ cognitive: { understanding: 70, confusion: 20 }, hasHistory: true, now: NOW, lastReviewedAt: NOW });
  const unit = recommendNextAction({ cognitive: { understanding: 0.7, confusion: 0.2 }, hasHistory: true, now: NOW, lastReviewedAt: NOW });
  assert.equal(pct.action, unit.action);
  // Write side (Education Engine): the caller names its scale; a mismatch is refused.
  assert.equal(toUnitScore(0.8), 0.8);
  assert.equal(toUnitScore(80, { scale: "percent" }), 0.8);
  assert.equal(toUnitScore(80), null, "80 handed over as 0–1 is refused, not clamped to a perfect 1");
  assert.equal(toUnitScore(101, { scale: "percent" }), null);
  assert.equal(toUnitScore(-0.1), null);
  assert.equal(toUnitScore(true), null);
  assert.equal(toUnitScore(undefined), null);
  assert.throws(() => toUnitScore(1, { scale: "permille" }), /unknown_scale/);
  assert.equal(toPercentScore(0.734), 73);
  assert.equal(toPercentScore(73), null);
  // masteryWriteBack's knowledge_confidence fallback goes through the guard and is unchanged.
  assert.deepEqual(masteryWriteBack({ knowledgeConfidence: 50, score: 1, passed: true }).previous, 0.5);
  assert.equal(masteryWriteBack({ currentMastery: 40, knowledgeConfidence: 60, score: 0.5, passed: false }).previous, 0.6, "a 0–100 'mastery' is not taken as 0–1");
});

test("a resumed session's misconception flags come from the learner model", () => {
  let state = createTeachingEvidenceState({ conceptCount: 3 });
  // Part 0: the session copy says unresolved; part 1 verified; part 2 untouched.
  state = applyTeachingObservation(state, 0, { coreExplanation: "clear", application: "clear", misconceptionPresent: true }).state;
  state = applyTeachingObservation(state, 1, { coreExplanation: "clear", application: "clear" }).state;
  assert.equal(state.concepts[0].unresolvedMisconception, true);
  assert.equal(state.concepts[1].masteryStatus, "verified");

  // Central: part 0 repaired elsewhere (false), part 1 a misconception found since (true), part 2 no record (null).
  applyCentralMisconceptions(state, [false, true, null]);
  assert.equal(state.concepts[0].unresolvedMisconception, false);
  assert.equal(state.concepts[0].masteryStatus, "verified", "repaired centrally → the evidence it already had counts");
  assert.equal(state.concepts[1].unresolvedMisconception, true);
  assert.notEqual(state.concepts[1].masteryStatus, "verified", "an active central misconception blocks mastery");
  assert.equal(state.concepts[1].lastDialogueMove, DIALOGUE_MOVES.REPAIR_MISCONCEPTION);
  assert.equal(state.concepts[2].unresolvedMisconception, false, "no central record → the session's own value stays");
  assert.equal(applyCentralMisconceptions(null, [true]), null);
});

test("misconception titles come from learner_concept_state rows (deduped, bounded)", () => {
  const rows = [
    { misconception_active: true, concept: { title: "Osmosis" } },
    { misconception_active: false, concept: { title: "Diffusion" } },
    { misconception_active: true, concept: [{ title: "Osmosis" }] },
    { misconception_active: true, concept: { title: "Active transport" } },
    { misconception_active: true, concept: null },
  ];
  assert.deepEqual(misconceptionTitles(rows), ["Osmosis", "Active transport"]);
  assert.deepEqual(misconceptionTitles(rows, { limit: 1 }), ["Osmosis"]);
});

test("wiring: one decision path; the session copies are retired or read from the centre", async () => {
  const [studentState, gate, controller, orchestrator, readTools, store, practice] = await Promise.all([
    read("./learner/student-state.js"), read("./teaching-session/state-machine.js"), read("./teaching-session/controller.js"),
    read("./agents/student/orchestrator.js"), read("./study-prep/read-tools.js"), read("./study-prep/store.js"), read("./practice/service.js"),
  ]);
  assert.doesNotMatch(studentState, /export function decideNextAction/, "decideNextAction is folded into the engine");
  assert.doesNotMatch(studentState, /mistakes:\s*_merge|strengths:\s*_merge/, "no per-agent mistakes/strengths arrays");
  assert.match(gate, /recommendNextAction\(\{ dialogueMove, actionForDialogueMove \}\)\.action/);
  assert.doesNotMatch(gate, /actionForDialogueMove\[dialogueMove\]/, "no second lookup in the gate");
  assert.match(controller, /recommendNextAction\(\{ dialogueMove: context\.evidenceUpdate\.dialogue\.move/);
  assert.doesNotMatch(controller, /actionForDialogueMove\?\.\[/);
  assert.match(orchestrator, /centralMisconceptionFlags\(/);
  assert.match(orchestrator, /applyCentralMisconceptions\(this\.teachingEvidence, flags\)/);
  assert.match(readTools, /misconception_active/);
  assert.match(readTools, /misconceptionTitles\(inSubject\)/);
  assert.match(store, /quality: unit,/, "Study Prep evidence passes through the scale guard");
  assert.match(practice, /toUnitScore\(Number\(outcome\.score\) \|\| 0, \{ scale: "percent" \}\)/, "Practice's 0–100 score is converted by the guard");
});
