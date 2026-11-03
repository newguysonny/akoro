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
