import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.SUPABASE_URL ||= "http://localhost:59999";
process.env.SUPABASE_SERVICE_KEY ||= "test-service-key";

const {
  TOOL_IDS, TOOL_LIMITS, toolCount, pagePassages, textPassages, samplePassages, chunkPassages,
  toolSchema, buildToolMessages, shapeToolResult, gatherToolPassages, mergeToolFolderPassages, citeOf,
  isFrontMatter, isBareHeading, isVerbatimCopy, isMetaQuestion,
} = await import("./toolsLib.js");
const routes = await readFile(new URL("./routes.js", import.meta.url), "utf8");
const toolsSrc = await readFile(new URL("./service-tools.js", import.meta.url), "utf8");
// The generation itself lives in studyMaterial.js (shared with Agent Chat).
const shared = await readFile(new URL("./studyMaterial.js", import.meta.url), "utf8");
const route = toolsSrc;

const block = (y, text) => ({ bbox_2d: [50, y, 950, y + 60], text_content: text });

test("form values → item counts", () => {
  assert.equal(toolCount("summary", { depth: "Brief" }), 4);
  assert.equal(toolCount("summary", { depth: "Detailed" }), 8);
  assert.equal(toolCount("quiz", { count: "10" }), 10);
  assert.equal(toolCount("quiz", { count: "999" }), 50, "the server caps a large count");
  assert.equal(toolCount("flashcards", { count: "3" }), 3);
  assert.deepEqual(TOOL_IDS, ["summary", "quiz", "flashcards"]);
});

test("a page's boxes become passages in reading order; figures are skipped", () => {
  const ps = pagePassages(4, { markdown: "", blocks: [block(500, "Second idea."), block(100, "First idea."), { bbox_2d: [0, 0, 10, 10], text_content: "<image>" }] });
  assert.deepEqual(ps.map((p) => [p.n, p.pageNumber, p.text]), [[1, 4, "First idea."], [2, 4, "Second idea."]]);
  assert.deepEqual(ps[0].bbox, [50, 100, 950, 160]);
});

test("a never-extracted page falls back to the reader's own text, sliced into passages", () => {
  const long = "Photosynthesis is how plants make food. ".repeat(60);
  const ps = textPassages(2, `Intro paragraph about cells and their parts.\n\n${long}`);
  assert.ok(ps.length >= 3);
  assert.ok(ps.every((p) => p.pageNumber === 2 && p.bbox === null && p.text.length <= TOOL_LIMITS.MAX_PASSAGE_CHARS));
});

test("whole-document sampling spreads across pages within the budget", () => {
  const pages = new Map(Array.from({ length: 40 }, (_, i) => [i + 1, { markdown: "", blocks: [block(100, `Page ${i + 1} main idea ${"x".repeat(200)}`)] }]));
  const ps = samplePassages(pages);
  assert.ok(ps.length <= TOOL_LIMITS.MAX_PASSAGES);
  const pageNums = ps.map((p) => p.pageNumber);
  assert.ok(pageNums[0] === 1 && pageNums.at(-1) > 30, "from the start to near the end");
  assert.ok(ps.reduce((n, p) => n + p.text.length, 0) <= TOOL_LIMITS.MAX_CONTEXT_CHARS);
});

test("recordings sample transcript windows with their moments", () => {
  const ps = chunkPassages(Array.from({ length: 50 }, (_, i) => ({ kind: "transcript", startMs: i * 30000, endMs: i * 30000 + 30000, text: `window ${i}` })));
  assert.ok(ps.length <= TOOL_LIMITS.MAX_PASSAGES);
  assert.equal(ps[0].startMs, 0);
});

test("the prompt is grounded, focused, and the schema is strict", () => {
  const ps = pagePassages(1, { blocks: [block(100, "Enzymes lower activation energy.")] });
  const msgs = buildToolMessages({ tool: "quiz", docName: "Bio", passages: ps, values: { count: "3", difficulty: "Hard", focus: "enzymes" } });
  assert.match(msgs[0].content, /Use ONLY the numbered passages/);
  assert.match(msgs[0].content, /Write 3 multiple-choice questions at Hard difficulty/);
  assert.match(msgs[0].content, /Concentrate on: enzymes/);
  assert.match(msgs[0].content, /\[1\] \(page 1\)\nEnzymes/);
  for (const t of TOOL_IDS) {
    const s = toolSchema(t);
    assert.equal(s.additionalProperties, false);
    const item = Object.values(s.properties)[0].items;
    assert.deepEqual([...item.required].sort(), Object.keys(item.properties).sort(), "strict mode: every property required");
  }
});

test("results are shaped for the views, cite their passage, and bad items are dropped", () => {
  const ps = pagePassages(3, { blocks: [block(100, "A"), block(200, "B")] });
  const summary = shapeToolResult("summary", { points: [{ text: "Point one", source: 1 }, { text: "Ghost", source: 9 }, { text: "No cite" }, { text: "  ", source: 2 }] }, ps, { depth: "Brief" });
  assert.deepEqual(summary.summaryPoints.map((p) => [p.text, p.cite?.pageNumber ?? null, p.cite?.bbox?.[1] ?? null]),
    [["Point one", 3, 100], ["Ghost", null, null], ["No cite", null, null]], "uncited points are kept without a citation");

  const quiz = shapeToolResult("quiz", { questions: [
    { prompt: "Q1?", options: ["a", "b", "c", "d"], correctIndex: 2, explanation: "because", source: 2 },
    { prompt: "Q2?", options: ["a", "b", "c"], correctIndex: 0, explanation: "", source: 1 },
    { prompt: "Q3?", options: ["a", "a", "c", "d"], correctIndex: 0, explanation: "", source: 1 },
    { prompt: "Q4?", options: ["a", "b", "c", "d"], correctIndex: 4, explanation: "", source: 1 },
  ] }, ps, { count: "5" });
  assert.equal(quiz.quizQuestions.length, 1, "3 options, duplicate options and an out-of-range answer are dropped");
  const q = quiz.quizQuestions[0];
  assert.deepEqual(q.options.map((o) => [o.key, o.correct]), [["A", false], ["B", false], ["C", true], ["D", false]]);
  assert.equal(q.explanation, "because");
  assert.equal(q.cite.pageNumber, 3);

  const cards = shapeToolResult("flashcards", { cards: [{ front: "Term", back: "Meaning", source: 1 }, { front: "", back: "x", source: 1 }] }, ps, { count: "3" });
  assert.deepEqual(cards.cardSet.map((c) => [c.front, c.back, c.cite.n]), [["Term", "Meaning", 1]]);
});

test("page scope with no extraction uses the reader's text; nothing at all → []", async () => {
  const target = { recordId: "r", ownerId: "o", contentKey: null, name: "Notes" };
  const ps = await gatherToolPassages({ target, scope: "page", pageNumber: 2, pageText: "Cells are the basic unit of life and every organism is built from them." });
  assert.equal(ps[0].pageNumber, 2);
  const none = await gatherToolPassages({ target, scope: "page", pageNumber: 2, pageText: "" });
  assert.deepEqual(none, []);
});

test("the route: auth, the Ask access rule, strict JSON, honest empty states", () => {
  assert.match(routes, /router\.post\("\/tools\/:tool", authenticateToken/);
  assert.match(route, /if \(!TOOL_IDS\.includes\(tool\)\) return res400/);
  assert.match(route, /const target = await resolveAskTarget\(req, req\.body\);/);
  assert.match(route, /generateToolResult\(\{ target, tool, scope,/);
  assert.match(route, /if \(g\.status\) return res\.status\(g\.status\)/);
  assert.match(shared, /response_format: \{ type: "json_schema", json_schema: \{ name: `reader_\$\{tool\}`, strict: true, schema: toolSchema\(tool\) \} \}/);
  assert.match(shared, /has no readable text yet/);
  assert.match(shared, /out of AI credit/);
  assert.match(shared, /response_format: { type: "json_object" }/, "a JSON-mode retry covers providers that ignore json_schema");
  assert.match(shared, /empty result", tool/, "an empty batch is diagnosable without dumping content");
  assert.match(route, /pageText\.slice\(0, TOOL_LIMITS\.MAX_PAGE_TEXT_CHARS\)|req\.body\.pageText\.slice\(0, TOOL_LIMITS\.MAX_PAGE_TEXT_CHARS\)/, "client text is capped");
});


test("near-schema model JSON is salvaged: letter answers, object options, missing sources", () => {
  const ps = [{ n: 1, pageNumber: 2, bbox: [0, 0, 10, 10], text: "A passage persons." }];
  const q = shapeToolResult("quiz", { questions: [{
    prompt: "Which?",
    options: [{ text: "one" }, { text: "two" }, { text: "three" }, { text: "four" }],
    answer: "C",
  }] }, ps, { count: "5" });
  assert.equal(q.quizQuestions.length, 1);
  assert.equal(q.quizQuestions[0].options[2].correct, true);
  assert.equal(q.quizQuestions[0].cite, null, "no fabricated citation");
});

test("folder tool passages pool across documents under the single-document caps", () => {
  const doc = (name, n) => Array.from({ length: n }, (_, i) => ({ kind: "page", pageNumber: i + 1, bbox: null, startMs: null, endMs: null, text: `${name} passage ${i + 1}`, sourceName: name, sourceRecordId: `id-${name}` }));
  const pooled = mergeToolFolderPassages([doc("Alpha", 12), doc("Beta", 12)]);
  assert.equal(pooled.length, TOOL_LIMITS.MAX_PASSAGES, "the folder set is capped like one document");
  assert.deepEqual(pooled.map((p) => p.n), pooled.map((_, i) => i + 1), "renumbered 1..n");
  assert.ok(pooled.some((p) => p.sourceName === "Alpha") && pooled.some((p) => p.sourceName === "Beta"), "both documents contribute");
  const cite = citeOf(pooled.find((p) => p.sourceName === "Beta"));
  assert.equal(cite.sourceName, "Beta", "a folder item's citation names its document");
  assert.equal(cite.sourceRecordId, "id-Beta");
  const single = citeOf({ n: 1, pageNumber: 2, text: "plain" });
  assert.ok(!("sourceName" in single), "single-document citations are unchanged");
});

test("passage hygiene: title blocks and bare headings never reach the model", () => {
  const title = "BIO 111 | GENERAL BIOLOGY | BIO 111 GENERAL BIOLOGY | CELL STRUCTURE AND ORGANIZATION Textbook-level lecture note • Core cell biology • Designed for first-year Pharm.D";
  assert.equal(isFrontMatter(title), true);
  assert.equal(isFrontMatter("Cells acquire and transform matter and energy to stay alive."), false);
  assert.equal(isBareHeading("3. Cellular Scale and the Methods Used to Study Cells"), true);
  assert.equal(isBareHeading("Robert Hooke used the word cells in 1665 after examining cork."), false);
  const ps = pagePassages(1, { markdown: "", blocks: [
    block(50, title),
    block(150, "Cell Structure and Organization"),
    block(300, "A cell is the smallest organisational unit that can perform the processes of living systems."),
  ] });
  assert.deepEqual(ps.map((p) => p.text), ["A cell is the smallest organisational unit that can perform the processes of living systems."], "only the body block becomes a passage");
  const titleOnly = pagePassages(1, { markdown: "", blocks: [block(50, title)] });
  assert.equal(titleOnly.length, 1, "a page with nothing else keeps its block rather than going empty");
});

test("the prompt bans document-meta questions and copied wording", () => {
  const ps = pagePassages(1, { blocks: [block(100, "Enzymes lower activation energy.")] });
  const quiz = buildToolMessages({ tool: "quiz", docName: "Bio", passages: ps, values: { count: "3" } });
  assert.match(quiz[0].content, /Never ask about the document as an object/);
  assert.match(quiz[0].content, /voice of a real exam/);
  const cards = buildToolMessages({ tool: "flashcards", docName: "Bio", passages: ps, values: { count: "3" } });
  assert.match(cards[0].content, /never a sentence, heading or title copied/);
});

test("quality gate: meta questions and verbatim copies are dropped, real items kept", () => {
  assert.equal(isMetaQuestion("Section 1 of the document is described as covering which topic?"), true);
  assert.equal(isMetaQuestion("Under the octet rule described in the passage, how many electrons are shared?"), true, "'in the passage' is the fake-exam tell Matt flagged");
  assert.equal(isMetaQuestion("According to the passage, what did Hooke observe?"), true);
  assert.equal(isMetaQuestion("Which scientist first observed living microorganisms?"), false);
  const passage = "The mitochondria is the powerhouse of the cell and it produces most of the cell's supply of ATP energy for work.";
  assert.equal(isVerbatimCopy("The mitochondria is the powerhouse of the cell and it produces most of the cell's supply", passage), true);
  assert.equal(isVerbatimCopy("Which organelle produces most of the cell's ATP?", passage), false);

  const ps = [{ n: 1, pageNumber: 1, bbox: [0, 0, 10, 10], text: passage }];
  const quiz = shapeToolResult("quiz", { questions: [
    { prompt: "Section 1 of the document is described as covering which topic?", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "x", source: 1 },
    { prompt: "The mitochondria is the powerhouse of the cell and it produces most of the cell's supply of ATP energy for work.", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "x", source: 1 },
    { prompt: "Which organelle produces most of the cell's ATP?", options: ["Mitochondria", "Nucleus", "Ribosome", "Golgi body"], correctIndex: 0, explanation: "It makes ATP.", source: 1 },
  ] }, ps, { count: "5" });
  assert.deepEqual(quiz.quizQuestions.map((q) => q.prompt), ["Which organelle produces most of the cell's ATP?"], "only the real question survives");

  const cards = shapeToolResult("flashcards", { cards: [
    { front: "BIO 111 | GENERAL BIOLOGY | CELL STRUCTURE AND ORGANIZATION", back: "x", source: 1 },
    { front: "The mitochondria is the powerhouse of the cell and it produces most of the cell's supply", back: "x", source: 1 },
    { front: "Mitochondria", back: "The organelle that produces most of the cell's ATP, its main energy supply.", source: 1 },
  ] }, ps, { count: "6" });
  assert.deepEqual(cards.cardSet.map((c) => c.front), ["Mitochondria"], "the title card and the copied card are dropped");
});
