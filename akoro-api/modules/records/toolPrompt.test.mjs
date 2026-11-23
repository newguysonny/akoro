// The Prompt box must DRIVE the form, not decorate it. These are the learner
// phrasings that exposed the gap.
import assert from "node:assert/strict";
import test from "node:test";
import { applyPromptIntent, parseToolPrompt } from "./toolPrompt.js";
import { buildToolMessages } from "./toolsLib.js";

test("WAEC-style quiz using attached past questions", () => {
  const p = parseToolPrompt("Customize quiz to WAEC level using the past questions attached");
  assert.equal(p.exam, "WAEC");
  assert.equal(p.referencesContext, true);
  assert.equal(p.count, null);
  assert.deepEqual(p.pageNumbers, []);
});

test("20 hard questions from pages 5–15, WAEC, attached past questions", () => {
  const p = parseToolPrompt("Create 20 hard questions from page 5-15 waec level using the past questions attached");
  assert.equal(p.count, 20);
  assert.equal(p.difficulty, "Hard");
  assert.equal(p.exam, "WAEC");
  assert.deepEqual(p.pageNumbers, [5,6,7,8,9,10,11,12,13,14,15]);
  assert.equal(p.referencesContext, true);
});

test("a syllabus customises flashcards for the whole document", () => {
  const p = parseToolPrompt("I added a syllabus use that to customize the flashcards for the whole document");
  assert.equal(p.wholeDocument, true);
  assert.equal(p.referencesContext, true);
  assert.equal(p.count, null);
});

test("typed card counts and page lists", () => {
  const p = parseToolPrompt("make 8 easy flashcards from pages 2, 3 and 9");
  assert.equal(p.count, 8);
  assert.equal(p.difficulty, "Easy");
  assert.deepEqual(p.pageNumbers, [2,3,9]);
});

test("the prompt overrides form defaults; the form is the fallback", () => {
  const a = applyPromptIntent({
    prompt: "3 easy questions from pages 2-4", scope: "page", pageNumbers: [],
    values: { count: "5", difficulty: "Medium" }, contextAttached: false,
  });
  assert.equal(a.scope, "pages");
  assert.deepEqual(a.pageNumbers, [2,3,4]);
  assert.equal(a.values.count, "3");
  assert.equal(a.values.difficulty, "Easy");
  const b = applyPromptIntent({ prompt: "just make it clearer", scope: "page", pageNumbers: [], values: { count: "5", difficulty: "Medium" } });
  assert.equal(b.scope, "page");
  assert.equal(b.values.count, "5");
  assert.equal(b.values.difficulty, "Medium");
  const c = applyPromptIntent({ prompt: "use the whole document", scope: "pages", pageNumbers: [2,3], values: {} });
  assert.equal(c.scope, "document");
  assert.deepEqual(c.pageNumbers, []);
});

test("context references become an instruction only when material is attached", () => {
  const withCtx = applyPromptIntent({ prompt: "shape it to the attached syllabus", scope: "document", values: {}, contextAttached: true });
  assert.ok(withCtx.notes.some((n) => /Use the attached reference material/.test(n)));
  const without = applyPromptIntent({ prompt: "shape it to the attached syllabus", scope: "document", values: {}, contextAttached: false });
  assert.ok(without.notes.some((n) => /none is attached/.test(n)));
  const exam = applyPromptIntent({ prompt: "WAEC level", scope: "document", values: {}, contextAttached: false });
  assert.ok(exam.notes.some((n) => /WAEC exam style/.test(n)));
});

test("intent notes and context land in the prompt before the passages", () => {
  const msgs = buildToolMessages({
    tool: "quiz", docName: "Cell", passages: [{ n: 1, text: "Cells have membranes.", pageNumber: 1 }],
    values: { count: "3" }, contextText: "CTXMARK", intentNotes: ["WAECSTYLE"],
  });
  const sys = msgs[0].content;
  assert.ok(sys.includes("CTXMARK") && sys.includes("WAECSTYLE"));
  assert.ok(sys.indexOf("CTXMARK") > -1 && sys.indexOf("CTXMARK") < sys.indexOf("Passages:"), "context precedes the tested passages");
});

test("podcasts receive the same intent and reference block", async () => {
  const { buildPodcastMessages, PODCAST_LENGTHS } = await import("./podcastLib.js");
  const msgs = buildPodcastMessages({
    docName: "Cell", passages: [{ n: 1, text: "Cells have membranes.", pageNumber: 1 }],
    length: PODCAST_LENGTHS.short, contextText: "CTX2", intentNotes: ["WAEC2"],
  });
  const sys = msgs[0].content;
  assert.ok(sys.includes("CTX2") && sys.includes("WAEC2"));
  assert.ok(sys.indexOf("CTX2") < sys.indexOf("Passages:"));
});

test("more learner phrasings", () => {
  const jamb = parseToolPrompt("Make a 10-question JAMB-style quiz on the whole document");
  assert.equal(jamb.count, 10);
  assert.equal(jamb.exam, "JAMB");
  assert.equal(jamb.wholeDocument, true);

  const syllabusCards = parseToolPrompt("Use the attached syllabus to build 12 flashcards covering the whole document");
  assert.equal(syllabusCards.count, 12);
  assert.equal(syllabusCards.referencesContext, true);
  assert.equal(syllabusCards.wholeDocument, true);

  const lastYear = parseToolPrompt("I uploaded last year's test; make 15 similar questions from the whole document");
  assert.equal(lastYear.count, 15);
  assert.equal(lastYear.referencesContext, true);

  const pageOnly = parseToolPrompt("Only pages 8-10, hard, 12 questions");
  assert.deepEqual(pageOnly.pageNumbers, [8,9,10]);
  assert.equal(pageOnly.difficulty, "Hard");
  assert.equal(pageOnly.count, 12);

  const podcast = parseToolPrompt("Make a short episode on pages 4-6 using the syllabus");
  assert.equal(podcast.length, "Short · 2–3 min");
  assert.deepEqual(podcast.pageNumbers, [4,5,6]);
  assert.equal(podcast.referencesContext, true);
});

test("a prompted summary point count is honoured (not just the Depth dropdown)", async () => {
  const { toolCount } = await import("./toolsLib.js");
  assert.equal(toolCount("summary", { count: "6", depth: "Brief" }), 6);
  assert.equal(toolCount("summary", { depth: "Brief" }), 4);
  assert.equal(toolCount("summary", { count: "99" }), 12, "capped");
});
