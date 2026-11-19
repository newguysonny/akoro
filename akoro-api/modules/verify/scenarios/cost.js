// Lever 3 (token-cost plan): the task-context pre-filter distils attached files
// before the model sees them — deterministic, so its output never drifts.
export const contextPrefilter = {
  name: "cost.context_prefilter", area: "cost", risk: "read",
  description: "The task-context pre-filter drops empty files, dedups whitespace-identical OCR, and caps per-file/total chars with a marker — fewer input tokens, same distinct content.",
  async run(ctx) {
    const { preFilterFileTexts } = await import("../../tasks/index.js");
    const { fileTexts, stats } = preFilterFileTexts([
      { fileName: "a", text: "Water cycle evaporation condensation" },
      { fileName: "b", text: "  Water cycle evaporation   condensation " },  // dup of a
      { fileName: "c", text: "    " },                                       // empty
      { fileName: "d", text: "x".repeat(5000) },                             // oversized
    ], { perFileChars: 200, totalChars: 1000 });

    ctx.expect.eq("duplicate OCR dropped", stats.deduped, 1);
    ctx.expect.ok("oversized file truncated", stats.truncated >= 1, stats);
    ctx.expect.eq("only distinct, non-empty files kept", fileTexts.map((f) => f.fileName).join(","), "a,d");
    ctx.expect.ok("output is smaller than input", stats.charsOut < stats.charsIn, stats);
    ctx.expect.ok("small distinct inputs are unchanged", (() => {
      const r = preFilterFileTexts([{ fileName: "n", text: "short note" }]);
      return r.fileTexts[0].text === "short note" && r.stats.truncated === 0;
    })(), {});
  },
};

// Lever 3 (chat surface): recalled memory is deduped and capped before the prompt.
export const memoryPrefilter = {
  name: "cost.memory_prefilter", area: "cost", risk: "read",
  description: "Recalled learner memory is deduped (whitespace-insensitive) and capped by count and characters before it enters the prompt — same distinct memory, fewer tokens.",
  async run(ctx) {
    const { preFilterMemories } = await import("../../adaptive-learning/chat/chat-memory.js");
    const { memories, stats } = preFilterMemories([
      { kind: "note", content: "Likes fractions" },
      { kind: "note", content: "  Likes   fractions " },
      { kind: "note", content: "   " },
    ]);
    ctx.expect.eq("duplicate memory dropped", stats.deduped, 1);
    ctx.expect.eq("one distinct memory kept", memories.length, 1);
    const capped = preFilterMemories(Array.from({ length: 50 }, (_, i) => ({ kind: "note", content: `n${i}` })), { maxItems: 12 });
    ctx.expect.eq("item cap enforced", capped.memories.length, 12);
  },
};

// Lever 4: the quiz scaffold (ids, numbers, marks, lettered options) is built in code.
export const quizScaffold = {
  name: "cost.quiz_scaffold", area: "cost", risk: "read",
  description: "The quiz scaffold is deterministic code: ids, sequential numbers, marks and lettered options are assembled from the model's content rows, so the fixed shape is identical every run.",
  async run(ctx) {
    const { assembleQuiz } = await import("../../tasks/index.js");
    let i = 0;
    const out = assembleQuiz([
      { question: "2+2?", options: ["1", "2", "3", "4"], answer: "4" },
      { question: "Explain gravity" },
    ], { marksPerQuestion: 3, format: "mixed", idFactory: () => `id-${++i}` });
    ctx.expect.eq("two questions assembled", out.length, 2);
    ctx.expect.eq("sequential numbers", out.map((q) => q.n).join(","), "1,2");
    ctx.expect.eq("marks applied from the request", out.map((q) => q.marks).join(","), "3,3");
    ctx.expect.eq("options lettered", (out[0].options || []).join("|"), "A. 1|B. 2|C. 3|D. 4");
    ctx.expect.eq("no options on a short-answer", "options" in out[1], false);
  },
};

// Lever 4: worksheet/lesson-plan fixed shape (numbers, letters, types, phases) is scripted.
export const generatorScaffold = {
  name: "cost.generator_scaffold", area: "cost", risk: "read",
  description: "Worksheet and lesson-plan structure is built in code: question numbers, lettered options, type coercion, and request-owned subject/class/duration with a canonical phase skeleton.",
  async run(ctx) {
    const { assembleWorksheetQuestions, assembleLessonPlan } = await import("../../tasks/index.js");
    const qs = assembleWorksheetQuestions([
      { type: "mcq", question: "Capital of France?", options: ["Paris", "Rome"], answer: "Paris" },
      { question: "Explain osmosis" },
    ]);
    ctx.expect.eq("questions numbered", qs.map((q) => q.n).join(","), "1,2");
    ctx.expect.eq("options lettered", (qs[0].options || []).join("|"), "A. Paris|B. Rome");
    ctx.expect.eq("short answer has no options", "options" in qs[1], false);
    const lp = assembleLessonPlan({ phases: [] }, { subject: "Biology", yearGroup: "SS2", durationMins: 40 });
    ctx.expect.eq("phases are canonical", lp.phases.map((p) => p.name).join(","), "Starter,Main,Plenary");
    ctx.expect.eq("minutes sum to the lesson", lp.phases.reduce((n, p) => n + p.minutes, 0), 40);
    ctx.expect.eq("duration from the request", lp.durationMins, 40);
  },
};

// Lever 5: expensive extraction is compile-once (content-hash artifact cache).
export const ingestOnce = {
  name: "cost.ingest_once", area: "cost", risk: "read",
  description: "Expensive extraction (vision/long-context) is compile-once: the same document bytes reuse the stored artifact instead of re-running the extractor.",
  async run(ctx) {
    const { contentKey, extractOnce } = await import("../../../lib/extractionCache.js");
    const store = new Map();
    let calls = 0;
    const extract = async () => { calls++; return { name: "Physics", topics: [] }; };
    const get = async (k) => store.get(k) ?? null;
    const put = async (k, v) => { store.set(k, v); };
    const key = contentKey(Buffer.from(ctx.marker), { scope: "verify" });
    const a = await extractOnce({ key, extract, get, put });
    const b = await extractOnce({ key, extract, get, put });
    ctx.expect.eq("first call is a miss", a.cached, false);
    ctx.expect.eq("second call is a hit", b.cached, true);
    ctx.expect.eq("the extractor ran once", calls, 1);
    ctx.expect.ok("different bytes → different key", contentKey(Buffer.from("x"), { scope: "verify" }) !== contentKey(Buffer.from("y"), { scope: "verify" }), {});
  },
};

// Lever 4/3 (activities workbench): the study-plan shape is assembled in code.
export const activitiesPlan = {
  name: "cost.activities_plan", area: "cost", risk: "read",
  description: "The activity study plan is scripted: deduped subtopics, objectives keyed to exactly those subtopics, and a placeholder when the model returned none.",
  async run(ctx) {
    const { assemblePlan } = await import("../../self-study/index.js");
    const { subtopics, objectives } = assemblePlan(
      ["  Cells ", "Cells", "Genetics", ""],
      { Cells: ["Identify organelles"], Genetics: [] },
    );
    ctx.expect.eq("subtopics deduped", subtopics.join(","), "Cells,Genetics");
    ctx.expect.eq("objectives keyed to subtopics", Object.keys(objectives).join(","), "Cells,Genetics");
    ctx.expect.ok("missing objectives get a placeholder", String((objectives.Genetics || [])[0] || "").includes("Genetics"), objectives.Genetics);
  },
};

// Lever 4 (teaching resources): drafts emit content only; the server fills structure.
export const teachingScaffold = {
  name: "cost.teaching_scaffold", area: "cost", risk: "read",
  description: "Teaching-resource drafts emit content only; kind/tone/layout are filled in code (the fixed document structure is not model output).",
  async run(ctx) {
    const { assembleResourceDoc, COMPACT_TEMPLATE_RULE } = await import("../../teaching/contentScaffold.js");
    const out = assembleResourceDoc({ entries: [{ title: "x", sections: [
      { label: "Common Misconception", body: "..." },
      { label: "Fix Strategies", items: ["a", "b"] },
      { label: "Materials", items: [{ label: "Board", value: "Chalk" }] },
    ] }] });
    const s = out.entries[0].sections;
    ctx.expect.eq("kinds inferred", s.map((x) => x.kind).join(","), "text,list,fields");
    ctx.expect.eq("tone derived from label", s[0].tone, "danger");
    ctx.expect.eq("layout defaulted", out.entries[0].layout, "stack");
    ctx.expect.ok("draft rule omits kind/tone/layout", /Omit "kind", "tone" and "layout"/.test(COMPACT_TEMPLATE_RULE), {});
  },
};
