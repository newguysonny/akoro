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
  params: { file: { default: "waec-biology.pdf" }, exam: { default: "WASSCE" }, name: { default: "Biology" }, dump: { default: true }, pages: { default: 35 }, minTopics: { default: 5 }, minSubtopics: { default: 30 }, minNotes: { default: 10 }, minPapers: { default: 2 } },
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
    ctx.expect.ok(`all ${p.pages} pages were read`, st.pages === Number(p.pages), st.pages);
    ctx.expect.ok("it has topics", doc.topics.length >= Number(p.minTopics), doc.topics.length);
    ctx.expect.ok("…with many subtopics (the syllabus is long; nothing cut off at the end)", st.subtopics >= Number(p.minSubtopics), st.subtopics);
    if (Number(p.minNotes) > 0) ctx.expect.ok("the NOTES column is kept", st.withNotes >= Number(p.minNotes), st.withNotes);
    ctx.expect.ok("the aims are read", String(doc.aims || "").length > 80);
    if (Number(p.minPapers) > 0) ctx.expect.ok("the scheme of examination is read", (doc.paper_structure?.papers || []).length >= Number(p.minPapers), doc.paper_structure);
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

/**
 * The batch path: several bundled PDFs through startBatch (the admin page's
 * multi-file upload) — named from their file names, queued two at a time,
 * each ending as its own draft.
 */
export const syllabusImportBatch = {
  name: "syllabus.import_batch", area: "syllabus", risk: "write", timeoutMs: 900_000,
  description: "Queues two bundled syllabus PDFs as one batch: each is named from its file name, runs through the queue, and ends as its own draft.",
  params: { files: { default: "jamb-biology.pdf,igcse-biology-0610.pdf" }, exam: { default: "JAMB" } },
  async run(ctx, p) {
    const names = String(p.files).split(",").map((f) => f.trim().replace(/[^a-z0-9._-]/gi, "")).filter(Boolean);
    const files = names.map((n) => ({ originalname: n, buffer: fs.readFileSync(new URL(`../../../data/syllabus/sources/${n}`, import.meta.url)) }));
    const { startBatch, get } = await import("../../adaptive-learning/syllabus-import/service.js");
    const { queued } = await startBatch({ files, exam: p.exam });
    ctx.expect.eq("every file is queued", queued.length, files.length);
    ctx.note(`queued: ${queued.map((q) => `${q.file} → ${q.name}${q.code ? ` (${q.code})` : ""}`).join(" · ")}`);
    const until = Date.now() + 600_000;
    let rows = [];
    while (Date.now() < until) {
      rows = await Promise.all(queued.map((q) => get(q.importId)));
      if (rows.every((r) => r && r.status !== "extracting")) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    for (const r of rows) ctx.note(`${r?.source_file}: ${r?.status} · ${r?.stats?.topics ?? "?"} topics · ${r?.stats?.subtopics ?? "?"} subtopics · ${r?.stats?.objectives ?? "?"} objectives · model ${r?.stats?.model ?? "?"}`);
    ctx.expect.ok("each file ends as its own draft", rows.every((r) => r?.status === "draft"), rows.map((r) => r?.status));
    ctx.expect.ok("each draft is named from its file", rows.every((r, i) => r?.name === queued[i].name), rows.map((r) => r?.name));
  },
};

/**
 * A combined syllabus (several subjects in one PDF, like the BECE compilation)
 * splits into one draft per subject: a 15-page cut of the BECE file with Basic
 * Science and Technology, Business Studies and Edo.
 */
export const syllabusImportSplit = {
  name: "syllabus.import_split", area: "syllabus", risk: "write", timeoutMs: 900_000,
  description: "Uploads a 3-subject cut of the combined BECE syllabus: it splits into Basic Science and Technology, Business Studies and Edo, each its own draft, book lists left out.",
  params: { file: { default: "bece-combined-sample.pdf" }, exam: { default: "BECE" } },
  async run(ctx, p) {
    const name = String(p.file).replace(/[^a-z0-9._-]/gi, "");
    const buffer = fs.readFileSync(new URL(`../../../data/syllabus/sources/${name}`, import.meta.url));
    const { startBatch } = await import("../../adaptive-learning/syllabus-import/service.js");
    const since = new Date(Date.now() - 1000).toISOString();
    await startBatch({ files: [{ originalname: name, buffer }], exam: p.exam });
    const until = Date.now() + 600_000;
    let rows = [];
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 6000));
      rows = (await ctx.db.rows("edu.syllabus_imports", { source_file: { like: `${name}%` } }, { columns: "id, name, exam, status, source_file, stats, created_at", limit: 50, order: { column: "created_at", ascending: true } }))
        .filter((r) => r.created_at >= since);
      if (rows.length >= 3 && rows.every((r) => r.status !== "extracting")) break;
    }
    for (const r of rows) ctx.note(`${r.source_file} → ${r.name}: ${r.status} · ${r.stats?.topics ?? "?"} topics · ${r.stats?.subtopics ?? "?"} subtopics · ${r.stats?.pages ?? "?"} pages`);
    ctx.expect.eq("it splits into three subjects", rows.length, 3);
    ctx.expect.eq("…named from their introductions", rows.map((r) => r.name).join(" | "), "Basic Science and Technology | Business Studies | Edo");
    ctx.expect.ok("each subject is its own draft", rows.every((r) => r.status === "draft"), rows.map((r) => r.status));
    ctx.expect.ok("each draft has topics", rows.every((r) => (r.stats?.topics || 0) >= 1), rows.map((r) => r.stats?.topics));
    ctx.expect.eq("the book list is left out (Basic Science and Technology ends before Chapter Three)", rows[0]?.stats?.pages, 4);
  },
};

/**
 * The importer's curriculum mode: a NERDC curriculum (JSS 1–3 Mathematics,
 * 36 pages) imported as exam "NERDC" — theme, sub-theme and class from every
 * page's header, the six columns per topic — saved as a draft (published, it
 * goes to the curriculum bank, not the exam syllabi).
 */
export const curriculumImportExample = {
  name: "curriculum.import_example", area: "syllabus", risk: "write", timeoutMs: 900_000,
  description: "Imports the NERDC JSS 1–3 Mathematics curriculum through the syllabus importer's curriculum mode: classes, themes, sub-themes and topics with objectives, content, activities, resources and evaluation, as a draft.",
  params: { file: { default: "nerdc-jss1-3_maths.pdf" }, dump: { default: true } },
  async run(ctx, p) {
    const name = String(p.file).replace(/[^a-z0-9._-]/gi, "");
    const buffer = fs.readFileSync(new URL(`../../../data/syllabus/sources/${name}`, import.meta.url));
    const { run } = await import("../../adaptive-learning/syllabus-import/service.js");
    const t0 = Date.now();
    const row = await run({ buffer, fileName: name.replace(/^nerdc-/, ""), exam: "NERDC" });
    ctx.note(`import ${row?.id} → ${row?.status} in ${Math.round((Date.now() - t0) / 1000)}s · ${row?.name}`);
    ctx.expect.eq("the import finishes as a draft", row?.status, "draft");
    if (row?.status !== "draft") { ctx.note(`error: ${row?.error}`); return; }
    const doc = row.doc;
    const st = row.stats || {};
    ctx.note(`stats: ${JSON.stringify(st)}`);
    for (const w of row.warnings || []) ctx.note(`warning: ${w.text}`);
    ctx.expect.eq("it is a curriculum", `${doc.kind}/${doc.body}/${doc.subject}/${doc.stage}`, "curriculum/nerdc/Mathematics/junior");
    ctx.expect.eq("all three classes", (st.classes || []).join(","), "JSS 1,JSS 2,JSS 3");
    ctx.expect.ok("themes and sub-themes from the page headers", st.themes >= 4 && st.subthemes >= 10, { themes: st.themes, subthemes: st.subthemes });
    ctx.expect.ok("topics with their columns", st.topics >= 30 && st.objectives >= st.topics && st.activities >= st.topics, st);
    ctx.expect.ok("every topic sits under a theme and a class", doc.topics.every((t) => t.theme && t.class));
    ctx.expect.ok("no part failed", !(row.warnings || []).some((w) => w.kind === "chunk_failed"), row.warnings);
    if (p.dump) {
      const json = JSON.stringify({ id: row.id, stats: st, warnings: row.warnings, doc });
      for (let i = 0; i < json.length; i += 480) ctx.note(`DUMP ${String(i / 480).padStart(4, "0")} ${json.slice(i, i + 480)}`);
    }
  },
};
