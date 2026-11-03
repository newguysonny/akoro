/**
 * The syllabus importer on a live server: the bundled WAEC Biology syllabus
 * (data/syllabus/sources/waec-biology.pdf, a digital PDF) is read with its
 * layout, structured in page chunks by the model, and saved as a DRAFT in
 * edu.syllabus_imports for review — nothing is published. The draft is kept
 * (it is the example the review screen shows); `dump: true` writes the whole
 * structured document into the run's notes.
 */
import fs from "node:fs";

export const syllabusImportExample = {
  name: "syllabus.import_example", area: "syllabus", risk: "write", timeoutMs: 900_000,
  description: "Imports the WAEC Biology syllabus PDF as a draft: layout text, chunked structuring, merged topics with subtopics, content, notes and the scheme of examination; checks coverage and that nothing is published.",
  params: { file: { default: "waec-biology.pdf" }, exam: { default: "WASSCE" }, name: { default: "Biology" }, dump: { default: true } },
  async run(ctx, p) {
    const file = new URL(`../../../data/syllabus/sources/${String(p.file).replace(/[^a-z0-9._-]/gi, "")}`, import.meta.url);
    const buffer = fs.readFileSync(file);
    const { run } = await import("../../adaptive-learning/syllabus-import/service.js");
    const t0 = Date.now();
    const row = await run({ buffer, fileName: p.file, exam: p.exam, name: p.name });
    ctx.note(`import ${row?.id} → ${row?.status} in ${Math.round((Date.now() - t0) / 1000)}s`);
    ctx.expect.eq("the import finishes as a draft", row?.status, "draft");
    if (row?.status !== "draft") { ctx.note(`error: ${row?.error}`); return; }
    const doc = row.doc;
    const st = row.stats || {};
    ctx.note(`stats: ${JSON.stringify(st)}`);
    for (const w of row.warnings || []) ctx.note(`warning: ${w.text}`);
    ctx.expect.eq("the exam and subject are set", `${doc.exam}/${doc.name}`, `${p.exam}/${p.name}`);
    ctx.expect.ok("all 35 pages were read", st.pages === 35, st.pages);
    ctx.expect.ok("it has topics", doc.topics.length >= 5, doc.topics.length);
    ctx.expect.ok("…with many subtopics (the syllabus is long; nothing cut off at the end)", st.subtopics >= 30, st.subtopics);
    ctx.expect.ok("the NOTES column is kept", st.withNotes >= 10, st.withNotes);
    ctx.expect.ok("the aims are read", String(doc.aims || "").length > 80);
    ctx.expect.ok("the scheme of examination is read", (doc.paper_structure?.papers || []).length >= 2, doc.paper_structure);
    ctx.expect.ok("no part of the document failed", !(row.warnings || []).some((w) => w.kind === "chunk_failed"), row.warnings);
    const last = doc.topics.at(-1);
    ctx.note(`topics: ${doc.topics.map((t) => `${t.title} (${t.subtopics.length})`).join(" · ").slice(0, 480)}`);
    ctx.note(`last topic: ${last?.title} → ${last?.subtopics.at(-1)?.title}`);
    const [published] = await ctx.db.rows("edu.syllabus_imports", { id: row.id }, { columns: "status, subject_id", limit: 1 });
    ctx.expect.eq("nothing is published until an admin does it", published?.status, "draft");
    if (p.dump) {
      const json = JSON.stringify({ id: row.id, stats: st, warnings: row.warnings, doc });
      for (let i = 0; i < json.length; i += 480) ctx.note(`DUMP ${String(i / 480).padStart(4, "0")} ${json.slice(i, i + 480)}`);
    }
  },
};

/**
 * What syllabus imports cost: every model call the importer made (feature
 * syllabus_import in edu.ai_call_log), totalled, per model, and per import
 * (calls inside each import's created → finished window). Read only.
 */
export const syllabusImportCost = {
  name: "syllabus.import_cost", area: "syllabus", risk: "read",
  description: "Totals the model calls the syllabus importer made (tokens, cost, model) overall and per import, from edu.ai_call_log.",
  params: {},
  async run(ctx) {
    const calls = await ctx.db.rows("edu.ai_call_log", { feature: "syllabus_import" }, { columns: "model, tokens_in, tokens_out, cached_in, cost_usd, ok, ms, created_at", limit: 2000, order: { column: "created_at", ascending: true } });
    ctx.expect.ok("the importer's model calls are recorded", calls.length > 0, calls.length);
    const sum = (rows) => rows.reduce((a, r) => ({ calls: a.calls + 1, failed: a.failed + (r.ok ? 0 : 1), tokensIn: a.tokensIn + (r.tokens_in || 0), tokensOut: a.tokensOut + (r.tokens_out || 0), costUsd: a.costUsd + Number(r.cost_usd || 0) }), { calls: 0, failed: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 });
    const all = sum(calls);
    ctx.note(`all imports: ${JSON.stringify({ ...all, costUsd: +all.costUsd.toFixed(4) })}`);
    const byModel = {};
    for (const r of calls) (byModel[r.model] ||= []).push(r);
    for (const [m, rows] of Object.entries(byModel)) { const s = sum(rows); ctx.note(`model ${m}: ${s.calls} calls, ${s.tokensIn} in / ${s.tokensOut} out, $${s.costUsd.toFixed(4)}`); }
    const imports = await ctx.db.rows("edu.syllabus_imports", {}, { columns: "id, name, exam, status, stats, created_at, updated_at", limit: 50, order: { column: "created_at", ascending: true } });
    for (const im of imports) {
      const from = Date.parse(im.created_at) - 2000;
      const to = Date.parse(im.updated_at) + 15_000;
      const s = sum(calls.filter((r) => { const t = Date.parse(r.created_at); return t >= from && t <= to; }));
      ctx.note(`import ${im.exam} ${im.name} (${im.status}, ${im.stats?.pages ?? "?"} pages, ${im.stats?.chars ?? "?"} chars): ${s.calls} calls, ${s.tokensIn} in / ${s.tokensOut} out, $${s.costUsd.toFixed(4)}`);
    }
  },
};
