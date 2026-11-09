// Lever 3 (token-cost plan): the task-context pre-filter distils attached files
// before the model sees them — deterministic, so its output never drifts.
export const contextPrefilter = {
  name: "cost.context_prefilter", area: "cost", risk: "read",
  description: "The task-context pre-filter drops empty files, dedups whitespace-identical OCR, and caps per-file/total chars with a marker — fewer input tokens, same distinct content.",
  async run(ctx) {
    const { preFilterFileTexts } = await import("../../tasks/lib/contextPrefilter.js");
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
    const { preFilterMemories } = await import("../../adaptive-learning/chat-memory.js");
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
