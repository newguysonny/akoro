import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePresentation, resolveBinding, describeCatalogue } from "./uiCatalogue.js";
import { validateModeDefinition, applyModeAction, initialModeState } from "./modeSpec.js";

// ── The protégé tool, as the builder should propose it ──────────────────
const protegeDef = {
  kind: "mode",
  steer: "You are Ako, the learner's eager protégé. The learner is teaching YOU Newton's laws. Listen, restate what you understood in your own words, and ask a question whenever an explanation is unclear, skips a step, or gives no example. Track coverage with the tool's actions: mark a law covered only when you have heard both its definition and an example.",
  state: { topic: "", phase: "setup", sessions: 0, minutes: 0,
    coverage: [
      { title: "First Law — inertia", need: "definition + example", state: "todo" },
      { title: "Second Law — F = ma", need: "definition + example", state: "todo" },
      { title: "Third Law — action & reaction", need: "definition + example", state: "todo" },
    ],
    questions: [] },
  actions: [
    { name: "start_session", description: "Begin a teaching session on a topic.", params: { topic: { type: "string", required: true } },
      effects: [ { op: "set", path: "topic", value: "$topic" }, { op: "set", path: "phase", value: "teaching" }, { op: "inc", path: "sessions" } ] },
    { name: "mark_covered", description: "Mark a coverage item done once the learner has explained it with an example.", params: { title: { type: "string", required: true } },
      effects: [ { op: "mark", path: "coverage", matchField: "title", matchFrom: "title", set: { state: "done" } } ] },
    { name: "log_question", description: "Record a question you asked because an explanation was unclear.", params: { question: { type: "string", required: true } },
      effects: [ { op: "append", path: "questions", value: { text: "$question", open: true } } ] },
  ],
};
const protegeUi = { v: 1, slot: "tool.tab", body: [
  { type: "hero", title: "$state.topic", sub: "Ako is learning from you" },
  { type: "statRow", stats: [ { value: "$state.sessions", label: "SESSIONS" }, { value: "$state.minutes", label: "MINUTES TAUGHT" } ] },
  { type: "list", title: "Coverage", items: "$state.coverage", item: { title: "title", sub: "need", stateField: "state" } },
  { type: "list", title: "Open questions", items: "$state.questions", item: { title: "text" } },
  { type: "cta", label: "Continue teaching", message: "Let's continue my Teach My Protégé session." },
]};

test("protégé definition validates", () => {
  const v = validateModeDefinition(protegeDef);
  assert.equal(v.ok, true, v.errors.join("; "));
});
test("protégé presentation validates against its state keys", () => {
  const v = validatePresentation(protegeUi, { stateKeys: Object.keys(protegeDef.state) });
  assert.equal(v.ok, true, v.errors.join("; "));
});
test("start_session sets topic/phase and counts the session", () => {
  const s0 = initialModeState(protegeDef, {});
  const out = applyModeAction(protegeDef, s0, "start_session", { topic: "Newton's Laws" });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.state.topic, "Newton's Laws");
  assert.equal(out.state.phase, "teaching");
  assert.equal(out.state.sessions, 1);
});
test("mark_covered + log_question move the state the tab renders", () => {
  let s = initialModeState(protegeDef, {});
  s = applyModeAction(protegeDef, s, "mark_covered", { title: "first law — inertia" }).state; // case-insensitive match
  assert.equal(s.coverage[0].state, "done");
  assert.equal(s.coverage[1].state, "todo");
  s = applyModeAction(protegeDef, s, "log_question", { question: "Does the wall push back?" }).state;
  assert.equal(s.questions.length, 1);
  assert.equal(s.questions[0].open, true);
});
test("mark_covered on an unknown item fails honestly", () => {
  const out = applyModeAction(protegeDef, initialModeState(protegeDef, {}), "mark_covered", { title: "Fourth Law" });
  assert.equal(out.ok, false);
});

// ── Close the Book ───────────────────────────────────────────────────────
const ctbDef = {
  kind: "mode",
  steer: "Teach the learner the chosen topic from their material first. Then CLOSE THE BOOK: from that moment never quote, summarise or hint at the material's content. Ask the learner to recall everything they remember in their own words, score their recall against the key points with score_recall, probe gaps by shape only ('there is a stage after that — what happens in it?'), and only at reveal show the missed points with their source lines.",
  state: { topic: "", phase: "learn", keyPoints: [], recalledCount: 0 },
  actions: [
    { name: "set_key_points", description: "Store the topic's key points, all hidden, before the book closes.", params: { points: { type: "array", required: true } },
      effects: [ { op: "set", path: "keyPoints", value: "$points" } ] },
    { name: "begin_recall", description: "Close the book and start the recall phase.", params: {},
      effects: [ { op: "set", path: "phase", value: "recall" } ] },
    { name: "score_point", description: "Mark one key point recalled when the learner states it in their own words.", params: { title: { type: "string", required: true } },
      effects: [ { op: "mark", path: "keyPoints", matchField: "title", matchFrom: "title", set: { state: "recalled" } }, { op: "inc", path: "recalledCount" } ] },
    { name: "reveal", description: "End the recall: every still-hidden point becomes a revealed gap.", params: {},
      effects: [ { op: "set", path: "phase", value: "review" }, { op: "flip", path: "keyPoints", field: "state", from: "hidden", to: "missed" } ] },
  ],
};
const ctbUi = { v: 1, slot: "tool.tab", body: [
  { type: "hero", title: "$state.topic", sub: "Teach, close the book, recall" },
  { type: "stepper", steps: [ { label: "Learn" }, { label: "Recall" }, { label: "Review" } ], bind: "$state.phase", map: { learn: 0, recall: 1, review: 2 } },
  { type: "list", title: "Key points", items: "$state.keyPoints", item: { title: "title", stateField: "state" }, hiddenLabel: "Still in the book" },
]};

test("close-the-book definition + presentation validate", () => {
  assert.equal(validateModeDefinition(ctbDef).ok, true, validateModeDefinition(ctbDef).errors.join("; "));
  assert.equal(validatePresentation(ctbUi, { stateKeys: Object.keys(ctbDef.state) }).ok, true);
});
test("recall flow: hidden points score and reveal as missed", () => {
  let s = initialModeState(ctbDef, {});
  s = applyModeAction(ctbDef, s, "set_key_points", { points: [ { title: "Light stage splits water", state: "hidden" }, { title: "Calvin cycle builds sugar", state: "hidden" } ] }).state;
  s = applyModeAction(ctbDef, s, "begin_recall", {}).state;
  assert.equal(s.phase, "recall");
  s = applyModeAction(ctbDef, s, "score_point", { title: "Light stage splits water" }).state;
  assert.equal(s.keyPoints[0].state, "recalled");
  assert.equal(s.recalledCount, 1);
  s = applyModeAction(ctbDef, s, "reveal", {}).state;
  assert.equal(s.keyPoints[1].state, "missed");
  assert.equal(s.keyPoints[0].state, "recalled");
});

// ── Catalogue guards ─────────────────────────────────────────────────────
test("unknown component and undeclared state key are refused", () => {
  const bad = { v: 1, body: [ { type: "video", src: "x" } ] };
  assert.equal(validatePresentation(bad, { stateKeys: [] }).ok, false);
  const badBind = { v: 1, body: [ { type: "hero", title: "$state.nope" } ] };
  assert.equal(validatePresentation(badBind, { stateKeys: ["topic"] }).ok, false);
});
test("resolveBinding walks paths and passes literals through", () => {
  const data = { state: { topic: "Waves", coverage: [ { title: "A" } ] }, tool: { label: "L" } };
  assert.equal(resolveBinding("$state.topic", data), "Waves");
  assert.equal(resolveBinding("$state.coverage.0.title", data), "A");
  assert.equal(resolveBinding("plain", data), "plain");
  assert.ok(describeCatalogue().components.length >= 10);
});
test("a mode def with an effect on undeclared state is refused", () => {
  const bad = JSON.parse(JSON.stringify(protegeDef));
  bad.actions[0].effects.push({ op: "set", path: "nope", value: 1 });
  assert.equal(validateModeDefinition(bad).ok, false);
});

test("embedded $refs in content templates interpolate; unknown refs stay literal", async () => {
  const { substituteRefs } = await import("./modeSpec.js");
  const out = substituteRefs(
    { topic: "$topic", content: "State what $topic is and why it matters in $subject. Cost: $5.", other: "$missing" },
    { args: { topic: "Parts of speech" }, params: { subject: "English Language" } });
  assert.equal(out.topic, "Parts of speech");
  assert.equal(out.content, "State what Parts of speech is and why it matters in English Language. Cost: $5.");
  assert.equal(out.other, "$missing");
});
