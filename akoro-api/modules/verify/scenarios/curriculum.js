// Curriculum coverage: does Study Prep find real syllabus topics for a class
// and subject, or fall back to a generated outline (Grand Plan §8.7, Q1)?

export const syllabusCoverage = {
  name: "curriculum.syllabus_coverage", area: "study-prep", risk: "read",
  description: "A subject + class (default JSS1 Basic Science) resolves to real syllabus topics, with approved concepts behind them.",
  params: { subject: { default: "Basic Science" }, classLevel: { default: "JSS1" }, exam: { default: "WAEC" } },
  async run(ctx, p) {
    const { resolveTopics } = await import("../../adaptive-learning/study-prep/syllabus-resolver.js");
    let topics = [];
    try { topics = await resolveTopics({ subject: p.subject, classLevel: p.classLevel, exam: p.exam }); }
    catch (e) { ctx.expect.blocked(`syllabus lookup failed: ${e.message}`); }
    const subjects = await ctx.db.rows("edu.syllabus_subjects", { name: { like: `%${p.subject}%` } }, { columns: "id, exam, name, code", limit: 20 });
    ctx.note(`syllabus subjects matching "${p.subject}": ${subjects.map((s) => `${s.exam}/${s.name}${s.code ? ` (${s.code})` : ""}`).join(", ") || "none"}`);
    const flat = (Array.isArray(topics) ? topics : []).flatMap((s) => s.topics || [s]);
    ctx.note(`resolver: ${flat.length} topic(s) for ${p.classLevel} ${p.subject}${flat.length ? ` — e.g. ${flat.slice(0, 5).map((t) => t.title || t.label).join("; ")}` : ""}`);
    const concepts = await ctx.db.count("edu.concept_catalog", { subject: { like: `%${p.subject}%` } });
    const approved = await ctx.db.count("edu.concept_catalog", { subject: { like: `%${p.subject}%` }, status: "approved" });
    ctx.note(`concept_catalog rows for "${p.subject}": ${concepts} (${approved} approved)`);
    ctx.expect.gte(`${p.classLevel} ${p.subject} resolves to syllabus topics`, flat.length, 1);
    ctx.expect.gte(`approved concepts exist for ${p.subject}`, approved, 1);
  },
};
