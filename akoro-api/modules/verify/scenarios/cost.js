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
