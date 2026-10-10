import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const qp = await import("./questionPaper.js");
const dv = await import("./draftVersions.js");
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [chat, drafts, routes, guide] = await Promise.all([
  read("../adaptive-learning/chat.js"), read("./drafts.js"), read("./routes.js"), read("../adaptive-learning/agents/nana-esumai/guide.js"),
]);

const TRI = '<svg viewBox="0 0 100 100"><polygon points="0,0 100,0 0,100" stroke="#000" fill="none"/><text x="5" y="50">P</text></svg>';
const mcq = (t, extra = {}) => ({ text: t, type: "MCQ", max_points: 2, difficulty: "Easy", cognitive_level: "Recall", options: ["a", "b", "c", "d"], correct: 1, ...extra });
const theory = (t, extra = {}) => ({ text: t, type: "Theory", max_points: 5, difficulty: "Medium", cognitive_level: "Understand", ...extra });

test("the teacher's words become the plan the paper is held to", () => {
  const p = qp.parseQuestionRequest("5 questions on photosynthesis, 3 MCQ, 2 direct theory");
  assert.equal(p.total, 5);
  assert.deepEqual(p.mix, [{ label: "MCQ", kind: "mcq", count: 3 }, { label: "Theory", kind: "open", count: 2 }]);
  assert.equal(p.diagrams, null, "no diagrams unless asked");
  assert.equal(p.options, null);
  assert.equal(p.sections, false);
  const d = qp.parseQuestionRequest("three objective questions and two theory questions, 2 with diagrams, A to E options, 20 marks");
  assert.equal(d.total, 5);
  assert.equal(d.diagrams, 2);
  assert.equal(d.options, 5);
  assert.equal(d.totalPoints, 20);
  assert.equal(qp.parseQuestionRequest("label the parts of a flower, 4 questions").diagrams, true);
  assert.equal(qp.parseQuestionRequest("8 questions, no diagrams, no sections").diagrams, 0);
  assert.equal(qp.parseQuestionRequest("8 questions, no sections").sections, false);
  assert.equal(qp.parseQuestionRequest("8 questions, 2 diagram questions").total, 8, "a part isn't the total");
  assert.equal(qp.parseQuestionRequest("MCQ 2 marks each").totalPoints, null, "per-question marks aren't a total");
  // The agent's structured plan wins over the words.
  const m = qp.mergePlan(p, { mix: [{ label: "MCQ", kind: "mcq", count: 4 }], diagrams: 1, options: 5 });
  assert.equal(m.total, 4);
  assert.equal(m.diagrams, 1);
  assert.equal(m.options, 5);
  assert.equal(qp.describePlan(p), "5 questions (3 MCQ · 2 Theory)");
});

test("the model is told the contract: exact count and mix, 4 options, no sections, no figures unless asked", () => {
  const plan = qp.parseQuestionRequest("5 questions, 3 MCQ, 2 direct theory");
  const [sys, user] = qp.buildPaperMessages({ topic: "Photosynthesis", subject: "Basic Science", classLevel: "JSS 2", request: "5 questions, 3 MCQ, 2 direct theory", plan });
  assert.match(sys.content, /EXACTLY 5 questions/);
  assert.match(sys.content, /3 × "MCQ" \(multiple choice, 4 options\); 2 × "Theory" \(open answer, no options\)/);
  assert.match(sys.content, /exactly 4 options \(read as A–D\)/);
  assert.match(sys.content, /Do NOT use sections/);
  assert.match(sys.content, /Use no figures unless a question cannot be asked without one/);
  assert.match(user.content, /Class \/ level: JSS 2/);
  const withFig = qp.buildPaperMessages({ topic: "t", subject: "s", request: "", plan: qp.parseQuestionRequest("4 questions on flowers, include diagrams") })[0].content;
  assert.equal(qp.parseQuestionRequest("4 questions with diagrams").diagrams, 4, "all four have one");
  assert.match(withFig, /add a figure to the questions that are about one/);
  assert.match(withFig, /never A–D, those are the option letters/);
});

test("count check, one retry, then a warning — never a silent change", async () => {
  const calls = [];
  const replies = [
    { questions: [mcq("1"), mcq("2"), theory("3"), theory("4")] },                 // 4, two MCQ
    { questions: [mcq("1"), mcq("2"), mcq("3"), theory("4"), theory("5")], instructions: "Answer all questions." },
  ];
  const out = await qp.draftPaper({ chat: async (m) => { calls.push(m); return JSON.stringify(replies[calls.length - 1]); }, topic: "Photosynthesis", subject: "Basic Science", request: "5 questions, 3 MCQ, 2 theory" });
  assert.equal(calls.length, 2);
  assert.match(calls[1].at(-1).content, /Asked for 5 questions, got 4\. Asked for 3 MCQ, got 2\./);
  assert.equal(out.warning, null);
  assert.equal(out.paper.questions.length, 5);
  assert.deepEqual(out.paper.questions[0], { q: "1", type: "MCQ", max_points: 2, difficulty: "Easy", cognitive_level: "Recall", options: ["a", "b", "c", "d"], correct: 1 });
  assert.equal("sections" in out.paper, false);

  let n = 0;
  const still = await qp.draftPaper({ chat: async () => { n += 1; return JSON.stringify({ questions: [mcq("1"), theory("2")] }); }, topic: "t", subject: "s", request: "3 MCQ and 2 theory" });
  assert.equal(n, 2, "only one retry");
  assert.match(still.warning, /Asked for 5 questions, got 2\./);
  assert.equal(still.paper.questions.length, 2, "what came back is kept, with the warning");
  await assert.rejects(qp.draftPaper({ chat: async () => "{}", topic: "t", subject: "s", request: "" }), /no questions/);
});

test("figures: sanitized SVG with alt, or a slot for the teacher; wrong option counts flagged", () => {
  const p = qp.normalizePaper({ questions: [
    mcq("In the diagram below…", { figure: { svg: TRI, caption: "Fig. 1", alt: "A right triangle" } }),
    mcq("A leaf", { figure: { svg: "<script>x</script>", alt: "A leaf cross-section with the palisade layer labelled" } }),
    mcq("Five", { options: ["a", "b", "c", "d", "e", "f"] }),
  ] }, { options: 4 });
  assert.ok(p.questions[0].figure.svg.startsWith("<svg xmlns"));
  assert.equal(p.questions[0].figure.alt, "A right triangle");
  assert.equal(p.questions[1].figure, undefined);
  assert.equal(p.questions[1].figure_note, "A leaf cross-section with the palisade layer labelled");
  assert.equal(p.questions[2].options.length, 4);
  assert.deepEqual(qp.checkPaper(p, { diagrams: 0 }), ["Asked for no diagrams, but some questions have one."]);
  assert.deepEqual(qp.checkPaper({ questions: [mcq("x", { options: ["a", "b", "c", "d", "e"] })] }, {}), ["1 multiple-choice question doesn't have 4 options."]);
});

test("a follow-up copies untouched questions exactly and marks what changed", () => {
  const base = { instructions: "Answer all questions.", questions: [
    { q: "Gas taken in?", type: "MCQ", options: ["O2", "CO2", "N2", "H2"], correct: 1, max_points: 2, edited_by_teacher: true },
    { q: "Where?", type: "MCQ", options: ["a", "b", "c", "d"], correct: 2, max_points: 2 },
    { q: "Word equation?", type: "Theory", max_points: 5, figure: { svg: TRI, alt: "tri" } },
  ] };
  const { paper, changes } = qp.applyRevision(base, { note: "Q2 harder; new Q3 with a diagram", questions: [
    { from: 0 },
    { from: 1, changed: true, text: "Where, exactly?", type: "MCQ", options: ["w", "x", "y", "z"], correct: 0, max_points: 3 },
    { text: "Which arrow shows oxygen?", type: "MCQ", options: ["P", "Q", "R", "S"], correct: 2, max_points: 3, figure: { svg: TRI, alt: "leaf" } },
    { from: 2, changed: true, text: "Word equation, with conditions?", type: "Theory", max_points: 6, keep_figure: true },
    { from: 99 },
  ] });
  assert.deepEqual(paper.questions[0], base.questions[0], "copied byte for byte — the teacher's edits stay");
  assert.equal(paper.questions[1].q, "Where, exactly?");
  assert.ok(paper.questions[2].figure.svg);
  assert.equal(paper.questions[3].figure.alt, "tri", "kept figure");
  assert.equal(paper.questions.length, 4);
  assert.deepEqual(changes, { 1: "changed", 2: "new", 3: "changed" });
  assert.equal(qp.summarizePaper(paper).line, "4 questions (3 MCQ · 1 Theory) · 14 marks · 2 with a diagram");
});

test("revisions hold only what a follow-up can be checked on", async () => {
  const base = { questions: [{ q: "a", type: "MCQ", options: ["1", "2", "3", "4"], correct: 0 }] };
  let n = 0;
  const r = await qp.revisePaper({ chat: async () => { n += 1; return JSON.stringify({ note: "added", questions: [{ from: 0 }, theory("new")] }); }, topic: "t", subject: "s", request: "add 2 MCQ please", base });
  assert.equal(n, 1, "\"add 2 MCQ\" is a change, not a total — no retry");
  assert.equal(r.warning, null);
  n = 0;
  const f = await qp.revisePaper({ chat: async () => { n += 1; return JSON.stringify({ questions: [{ from: 0 }] }); }, topic: "t", subject: "s", request: "add a diagram question", base });
  assert.equal(n, 2);
  assert.match(f.warning, /Asked for diagrams, got none/);
});

test("versions: numbering, the cap, teacher edits and what assign sends", () => {
  let payload = { versions: [] };
  for (let i = 0; i < dv.MAX_VERSIONS; i++) payload.versions.push({ ...dv.newVersion(payload, { request: "x" }), status: "ready" });
  assert.equal(payload.versions.at(-1).n, 10);
  assert.throws(() => dv.newVersion(payload, { request: "x" }), /already has 10 versions/);
  payload.versions[9].status = "drafting";
  assert.equal(dv.latestReady(payload).n, 9);
  const v = { n: 2, status: "ready", paper: { questions: [{ q: "old" }] } };
  const e = dv.editedVersion(v, { questions: [{ q: "new", options: ["a", "b", "c", "d"], correct: 0, max_points: 2 }], instructions: "Answer all." });
  assert.equal(e.edited, true);
  assert.equal(e.paper.questions[0].q, "new");
  assert.equal(e.summary.totalPoints, 2);
  assert.throws(() => dv.editedVersion({ n: 3, status: "drafting" }, { questions: [{ q: "x" }] }), /still being drafted/);
  assert.throws(() => dv.editedVersion(v, { questions: [] }), /at least one question/);
  const d = dv.detailsFromVersion({ ai_auto_grade: true }, { n: 2, paper: { questions: [{ q: "a", type: "MCQ", max_points: 2 }, { q: "b", type: "Theory" }] } });
  assert.deepEqual([d.total_points, d.version, d.ai_auto_grade, d.question_types], [7, 2, true, ["MCQ", "Theory"]]);
});

test("one writer per draft at a time", async () => {
  const order = [];
  const slow = dv.withDraftLock("d1", async () => { await new Promise((r) => setTimeout(r, 30)); order.push("a"); });
  const fast = dv.withDraftLock("d1", async () => { order.push("b"); });
  const other = dv.withDraftLock("d2", async () => { order.push("c"); });
  await Promise.all([slow, fast, other]);
  assert.deepEqual(order, ["c", "a", "b"]);
  await assert.rejects(dv.withDraftLock("d1", async () => { throw new Error("boom"); }), /boom/);
  await dv.withDraftLock("d1", async () => order.push("after a failure"));
  assert.equal(order.at(-1), "after a failure");
});

test("wiring: chat tools carry the request; drafts build versions in the background; assign sends one", () => {
  assert.match(chat, /question_request: \{ type: "string", description: "assignment only: the instructor's own words/);
  assert.match(chat, /question_plan: \{ type: "object"/);
  assert.match(chat, /base_version: \{ type: "number"/);
  assert.match(chat, /\.\.\.\(toolResult\.version \? \{ version: toolResult\.version \} : \{\}\)/);
  assert.match(drafts, /payload\.versions = \[newVersion\(payload, \{ request: request \|\| `Questions on \$\{topic\}` \}\)\]/);
  assert.match(drafts, /void runVersionJob\(draft\.id, 1, \{ chat: questionChat\(instructor\.id\) \}\)/);
  assert.match(drafts, /is still being drafted — wait for it, then ask again/);
  assert.match(drafts, /payload\.details = detailsFromVersion\(payload\.details, v\)/);
  assert.match(drafts, /delete payload\.versions;/);
  assert.match(routes, /router\.put\("\/drafts\/:id\/versions\/:n"/);
  assert.match(routes, /router\.post\("\/drafts\/:id\/versions\/:n\/retry"/);
  assert.match(routes, /await draftPaper\(\{/);
  assert.match(guide, /async generateAssignmentQuestions\(\{ messages, billing = \{\} \}\)/);
});
