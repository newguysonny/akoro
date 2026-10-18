/**
 * The reader's backend, end to end on a test learner: a text PDF uploaded
 * like the app does is read into pages with their real sizes; the guide
 * teaches from it with citations and keeps its own thread; the study tools
 * cite it; the learner's items are kept. Everything is deleted afterwards.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";

const PARAS = [
  "The cell wall is a rigid layer outside the cell membrane of plant cells. It gives the plant cell its shape and stops it bursting when water enters by osmosis.",
  "Mitochondria are the sites of aerobic respiration. Mitochondria release the energy stored in glucose, so active cells such as muscle cells contain many mitochondria.",
  "The nucleus controls the activities of the cell. It contains chromosomes made of DNA, which carry the instructions for making proteins.",
];

export async function textPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  for (let n = 1; n <= 2; n++) {
    const page = pdf.addPage([595.28, 841.89]);   // A4 in points
    let y = 780;
    page.drawText(`Cell Structure — part ${n}`, { x: 56, y, size: 16, font });
    for (const para of PARAS) {
      const words = para.split(" ");
      let line = "";
      for (const w of words) {
        if ((line + " " + w).length > 85) { y -= 18; page.drawText(line.trim(), { x: 56, y, size: 11, font }); line = ""; }
        line += " " + w;
      }
      y -= 18; page.drawText(line.trim(), { x: 56, y, size: 11, font });
      y -= 12;
    }
  }
  return Buffer.from(await pdf.save());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const readerBackend = {
  name: "reader.backend", area: "reader", risk: "write",
  description: "A text PDF is read into pages with real sizes; the guide teaches from it with citations in its own thread (and teaches a plain topic too); Summary cites it; the learner's items are kept.",
  params: { learner: { default: "@tester18" } },
  async run(ctx, p) {
    const learner = await ctx.as(p.learner);
    const name = `${ctx.marker} Cell Structure.pdf`;
    const bytes = await textPdf();

    // 1. Upload the way the app does: presigned PUT, then register the record.
    const up = await ctx.http({ as: p.learner, method: "POST", path: "/api/records/upload-url", body: { name, mime: "application/pdf", size: bytes.length } });
    if (up.status !== 200 || !up.body?.data?.uploadUrl) ctx.expect.blocked(`upload-url answered ${up.status}: ${up.body?.message || ""}`);
    const put = await fetch(up.body.data.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes }).catch((e) => ({ status: String(e.message) }));
    if (!(put.status >= 200 && put.status < 300)) ctx.expect.blocked(`the file store refused the upload: ${put.status}`);
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/records", body: { kind: "upload", fileKey: up.body.data.fileKey, name, mime: "application/pdf", size: bytes.length } });
    const record = made.body?.data?.record || made.body?.data;
    ctx.expect.ok("the record is registered", !!record?.id, made.body);
    if (!record?.id) return;
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "DELETE", path: `/api/records/${record.id}` }));

    // 2. Its text, read into pages with their real size.
    let ext = null;
    for (let i = 0; i < 12; i++) {
      ext = await ctx.http({ as: p.learner, method: "POST", path: "/api/records/extract/text", body: { recordId: record.id } });
      if (ext.status !== 202) break;
      await sleep(5_000);
    }
    ctx.expect.eq("the text is read", ext?.status, 200);
    const pages = ext?.body?.data?.pages || [];
    ctx.expect.eq("two pages", pages.length, 2);
    ctx.expect.ok("…with the document's words", /mitochondria/i.test(pages.map((x) => x.markdown).join(" ")), pages.map((x) => (x.markdown || "").slice(0, 60)));
    const size = pages[0]?.size;
    ctx.expect.ok("…and the page's real size (A4 in points)", size && Math.abs(size.width - 595) < 2 && Math.abs(size.height - 842) < 2 && size.unit === "pt", size);

    // 3. The guide teaches from it — citations, its own thread. Search indexing may lag a moment.
    const message = "What do mitochondria do?";
    let g = null;
    for (let i = 0; i < 4; i++) {
      g = await ctx.http({ as: p.learner, method: "POST", path: "/api/records/guide", body: { recordId: record.id, message, guideName: "NaNa Esumai", topic: "Cell structure", subject: "Biology" } });
      if (g.status === 200 && (g.body?.data?.citations || []).length) break;
      await sleep(10_000);
    }
    ctx.expect.eq("the guide replies", g?.status, 200);
    const reply = g?.body?.data || {};
    ctx.note(`guide: ${String(reply.answer || "").slice(0, 300)}`);
    ctx.expect.ok("the reply teaches from the document (mitochondria / energy)", /mitochondri|energy|respiration/i.test(reply.answer || ""), reply.answer);
    ctx.expect.ok("the reply cites the document", (reply.citations || []).length > 0 && reply.citations.every((c) => Number.isInteger(c.pageNumber)), reply.citations);
    ctx.expect.ok("the reply ends with a check question", /\?\s*$/.test(String(reply.answer || "").trim()) || /\?/.test(String(reply.answer || "").split("\n").slice(-3).join(" ")), reply.answer);
    if (reply.saved !== true) {
      ctx.note(`save error: ${reply.saveError || "(none given)"}`);
      // Why not: is the column there (through the API's schema cache), and how did its migration run?
      const probe = await ctx.db.probe("edu.record_chat_messages", "id, channel");
      ctx.note(`channel column through the API: ${probe.ok ? "visible" : `NOT visible — ${probe.error}`}`);
      const runs = await ctx.db.rows("edu.migration_log", {}, { columns: "run_group, applied, failed, files, git_sha, ran_at", limit: 3, order: { column: "ran_at", ascending: false } }).catch(() => []);
      for (const r of runs) {
        const mine = (Array.isArray(r.files) ? r.files : []).find((f) => JSON.stringify(f).includes("record-chat-guide"));
        ctx.note(`migration run ${String(r.git_sha || "").slice(0, 8)} ${r.ran_at}: applied ${r.applied}, failed ${r.failed}; record-chat-guide: ${mine ? JSON.stringify(mine).slice(0, 300) : "not listed"}`);
      }
    }
    ctx.expect.eq("the turn is saved", reply.saved, true);
    const gh = await ctx.http({ as: p.learner, path: `/api/records/guide/history?recordId=${record.id}` });
    ctx.expect.ok("the guide thread holds the lesson", (gh.body?.data?.messages || []).some((m) => m.role === "user" && m.text === message));
    const ah = await ctx.http({ as: p.learner, path: `/api/records/ask/history?recordId=${record.id}` });
    ctx.expect.ok("…and Ask's thread does not", !(ah.body?.data?.messages || []).some((m) => m.text === message));

    // A session without a document: the topic, nothing saved.
    const plain = await ctx.http({ as: p.learner, method: "POST", path: "/api/records/guide", body: { topic: "Equivalent fractions", subject: "Mathematics", message: "Why is 2/4 the same as 1/2?", history: [] } });
    ctx.expect.eq("a topic-only guide reply", plain.status, 200);
    ctx.expect.ok("…teaches the topic", /half|1\/2|½|equivalent|same/i.test(plain.body?.data?.answer || ""), plain.body?.data?.answer);
    ctx.expect.eq("…and is not saved anywhere", plain.body?.data?.saved, false);

    // 4. Summary of the whole document, every point cited.
    const sum = await ctx.http({ as: p.learner, method: "POST", path: "/api/records/tools/summary", body: { recordId: record.id, scope: "document", values: { depth: "Brief" } } });
    ctx.expect.eq("Summary is generated", sum.status, 200);
    ctx.expect.ok("…and cites the pages", /"pageNumber":\s*[12]/.test(JSON.stringify(sum.body?.data || {})), JSON.stringify(sum.body?.data || {}).slice(0, 300));

    // 5. The learner's items are kept on this document.
    const note = await ctx.http({ as: p.learner, method: "POST", path: "/api/records/artifacts", body: { recordId: record.id, kind: "notes", pageNumber: 1, content: { text: `${ctx.marker} mitochondria release energy` } } });
    ctx.expect.ok("a note is saved", note.status === 200 || note.status === 201, note.body);
    const list = await ctx.http({ as: p.learner, path: `/api/records/artifacts?recordId=${record.id}` });
    ctx.expect.ok("…and listed for this document", (list.body?.data?.artifacts || []).some((a) => a.kind === "notes" && JSON.stringify(a.content).includes(ctx.marker)));
    void learner;
  },
};
