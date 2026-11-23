// Context is searched, not dumped: only the attached pieces that touch the
// document's concepts reach the model, and the role (past questions vs
// syllabus) changes the instruction.
import assert from "node:assert/strict";
import test from "node:test";
import { contextPromptBlock, detectContextMode, selectContextChunks } from "./toolContext.js";
import { shapeToolResult } from "./toolsLib.js";

const passages = [
  { n: 1, pageNumber: 2, text: "Photosynthesis converts light energy in the chloroplast; the thylakoid carries the light reactions and the stroma fixes carbon." },
  { n: 2, pageNumber: 3, text: "ATP and NADPH from the light reactions power the Calvin cycle." },
];
const pastPaper = {
  name: "WAEC past questions.pdf",
  text: [
    "Which reagent tests for starch? A. Iodine B. Limewater C. Benedict's D. Litmus",
    "In which organelle does photosynthesis take place? A. Nucleus B. Chloroplast C. Ribosome D. Vacuole",
    "Which gas is released during the light reactions? A. Oxygen B. Nitrogen C. Hydrogen D. Methane",
    "Name the industrial process used to make ammonia from nitrogen and hydrogen.",
  ].join("\n\n"),
};
const syllabus = {
  name: "Biology syllabus.pdf",
  text: "Week 1: Cell structure and organelles.\n\nWeek 2: Photosynthesis — light reactions and the Calvin cycle.\n\nWeek 3: Ecology and food webs.",
};

test("past questions: only the related questions are selected", () => {
  const out = selectContextChunks({ items: [pastPaper], passages, prompt: "WAEC questions using the past questions attached", mode: "past_questions" });
  assert.equal(out.mode, "past_questions");
  assert.equal(out.related, true);
  const text = out.chunks.map((c) => c.text).join(" ");
  assert.match(text, /photosynthesis|chloroplast/i);
  assert.doesNotMatch(text, /ammonia|starch|Iodine/i, "unrelated past questions are not sent");
  const block = contextPromptBlock(out.chunks, { mode: out.mode });
  assert.match(block, /PAST QUESTIONS/);
  assert.match(block, /contextSource/);
  assert.match(block, /\[Context 1: WAEC past questions\.pdf\]/);
});

test("syllabus: only the overlapping topics are selected, with mapping guidance", () => {
  const out = selectContextChunks({ items: [syllabus], passages, prompt: "use the syllabus to customize the flashcards", mode: "syllabus" });
  assert.equal(out.mode, "syllabus");
  assert.equal(out.related, true);
  const text = out.chunks.map((c) => c.text).join(" ");
  assert.match(text, /photosynthesis/i);
  assert.doesNotMatch(text, /food webs|Cell structure/i);
  const block = contextPromptBlock(out.chunks, { mode: out.mode });
  assert.match(block, /SYLLABUS/);
  assert.match(block, /Map its topics/);
});

test("an unrelated attachment yields no context instead of noise", () => {
  const out = selectContextChunks({ items: [{ name: "Chemistry.pdf", text: "Ammonia is made by the Haber process from nitrogen and hydrogen." }], passages, prompt: "make a quiz", mode: "reference" });
  assert.equal(out.related, false);
  assert.deepEqual(out.chunks, []);
});

test("the role is detected from the content when the prompt is silent", () => {
  assert.equal(detectContextMode([pastPaper], null), "past_questions");
  assert.equal(detectContextMode([syllabus], null), "syllabus");
});

test("only a real attached source name is carried onto an item", () => {
  const json = { questions: [
    { prompt: "Where does photosynthesis happen? A. Nucleus B. Chloroplast C. Ribosome D. Vacuole", options: ["Nucleus", "Chloroplast", "Ribosome", "Vacuole"], correctIndex: 1, explanation: "Chloroplasts carry photosynthesis.", source: 1, contextSource: "WAEC past questions.pdf" },
    { prompt: "What powers the Calvin cycle? A. ATP B. Salt C. Heat D. Sound", options: ["ATP", "Salt", "Heat", "Sound"], correctIndex: 0, explanation: "ATP and NADPH.", source: 2, contextSource: "Invented source.pdf" },
  ] };
  const shaped = shapeToolResult("quiz", json, passages, { count: "2" }, [{ name: "WAEC past questions.pdf", index: 1 }]);
  assert.equal(shaped.quizQuestions[0].contextName, "WAEC past questions.pdf");
  assert.equal(shaped.quizQuestions[1].contextName, undefined, "hallucinated sources are dropped");
});

test("a reused past question is attributed even when the model leaves contextSource empty", () => {
  const json = { questions: [{
    prompt: "In which organelle does photosynthesis take place?",
    options: ["Nucleus", "Chloroplast", "Ribosome", "Vacuole"], correctIndex: 1,
    explanation: "The chloroplast carries the light reactions.", source: 1, contextSource: "",
  }] };
  const ctx = [{ name: "WAEC past questions.pdf", index: 1, text: "In which organelle does photosynthesis take place? A. Nucleus B. Chloroplast C. Ribosome D. Vacuole" }];
  const shaped = shapeToolResult("quiz", json, passages, { count: "1" }, ctx);
  assert.equal(shaped.quizQuestions[0].contextName, "WAEC past questions.pdf");
});

test("cosine similarity is safe and ordered", async () => {
  const { cosine } = await import("./toolContext.js");
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([], [1]), 0);
  assert.equal(cosine([1, 0], [1]), 0);
});

test("embeddings pull in conceptually related context that shares no keywords", async () => {
  const { selectContextChunksHybrid } = await import("./toolContext.js");
  const synonym = { name: "Scheme.pdf", text: "Week 4: energy conversion inside plant cells and the release of oxygen." };
  const embed = async (texts) => texts.map((t) => (
    /energy conversion|photosynthesis|chloroplast/i.test(t) ? [1, 0.05] : [0.1, 1]
  ));
  const out = await selectContextChunksHybrid({
    items: [synonym], passages, prompt: "use the scheme to plan the quiz", embed,
  });
  assert.equal(out.related, true);
  assert.equal(out.semantic, true);
  assert.match(out.chunks[0].text, /energy conversion/i);
});

test("semantic closeness does not admit an unrelated question on its own", async () => {
  const { selectContextChunksHybrid } = await import("./toolContext.js");
  const unrelated = { name: "Past questions.pdf", text: "Which reagent tests for starch? A. Iodine B. Limewater C. Benedict's D. Litmus" };
  const embed = async (texts) => texts.map((t) => (/photosynthesis|chloroplast/i.test(t) ? [1, 0] : [0, 1]));
  const out = await selectContextChunksHybrid({ items: [unrelated], passages, prompt: "past questions", embed });
  assert.equal(out.related, false);
});

test("embeddings can be disabled and failures fall back to lexical", async () => {
  const { selectContextChunksHybrid } = await import("./toolContext.js");
  let called = false;
  const embed = async (texts) => { called = true; return texts.map(() => [1, 0]); };
  const off = await selectContextChunksHybrid({ items: [pastPaper], passages, prompt: "past questions", embed, embeddingsEnabled: false });
  assert.equal(called, false);
  assert.equal(off.related, true, "lexical selection still works");
  const broken = await selectContextChunksHybrid({ items: [pastPaper], passages, prompt: "past questions", embed: async () => { throw new Error("down"); } });
  assert.equal(broken.related, true);
  assert.equal(broken.semantic, undefined);
});

test("pasted context is labelled by its role, not its first question", async () => {
  const { contextLabel } = await import("./toolContext.js");
  assert.equal(contextLabel({ name: "Which organelle…", kind: "paste" }, "Which organelle does photosynthesis use? A. Chloroplast"), "Past questions (pasted note)");
  assert.equal(contextLabel({ name: "Week 1…", kind: "paste" }, "Week 1: photosynthesis"), "Syllabus (pasted note)");
  assert.equal(contextLabel({ name: "My revision notes", kind: "paste" }, "Some prose about cells."), "Pasted note — My revision notes");
  assert.equal(contextLabel({ name: "BIO 111.pdf", kind: "upload" }, "ignored"), "BIO 111.pdf");
});
