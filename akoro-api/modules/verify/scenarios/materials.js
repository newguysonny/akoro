/**
 * Materials to study (Grand Plan §7.17, D51–D53), on a test learner: a file
 * dropped into chat is filed in a private Library folder named from it, read,
 * and Undo removes exactly what the upload made. Everything is deleted.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { textPdf } from "./reader.js";
import { readLogs, logSeq } from "../../../lib/logTap.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A two-page past paper: numbered questions with printed marks. */
const QUESTIONS = [
  ["1", "(a) Define osmosis. (b) Describe an experiment using potato strips to show osmosis in plant tissue.", 12],
  ["2", "Explain how the rate of diffusion is affected by temperature and concentration gradient.", 8],
  ["3", "(a) Construct a food web for a pond habitat with five organisms. (b) Explain the role of decomposers in an ecosystem.", 15],
  ["4", "Using a genetic diagram, show the result of crossing a heterozygous tall pea plant with a dwarf pea plant.", 10],
  ["5", "Describe the structure of the mammalian heart and explain how blood flows through it.", 15],
];
export async function pastPaperPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const pages = [pdf.addPage([595.28, 841.89]), pdf.addPage([595.28, 841.89])];
  pages[0].drawText("WEST AFRICAN SENIOR SCHOOL CERTIFICATE EXAMINATION 2019 — BIOLOGY PAPER 2 (Essay)", { x: 40, y: 790, size: 11, font });
  pages[0].drawText("Answer all questions. Marks are shown in brackets.", { x: 40, y: 770, size: 10, font });
  QUESTIONS.forEach(([n, text, marks], i) => {
    const page = pages[i < 3 ? 0 : 1];
    let y = (i < 3 ? 730 : 780) - (i % 3) * 120;
    const words = `${n}. ${text} [${marks} marks]`.split(" ");
    let line = "";
    for (const w of words) {
      if ((line + " " + w).length > 90) { page.drawText(line.trim(), { x: 40, y, size: 11, font }); y -= 16; line = ""; }
      line += " " + w;
    }
    page.drawText(line.trim(), { x: 40, y, size: 11, font });
  });
  return Buffer.from(await pdf.save());
}

async function uploadRecord(ctx, as, name, bytesIn = null) {
  const bytes = bytesIn || await textPdf();
  const up = await ctx.http({ as, method: "POST", path: "/api/records/upload-url", body: { name, mime: "application/pdf", size: bytes.length } });
  if (up.status !== 200 || !up.body?.data?.uploadUrl) ctx.expect.blocked(`upload-url answered ${up.status}: ${up.body?.message || ""}`);
  const put = await fetch(up.body.data.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes }).catch((e) => ({ status: String(e.message) }));
  if (!(put.status >= 200 && put.status < 300)) ctx.expect.blocked(`the file store refused the upload: ${put.status}`);
  const made = await ctx.http({ as, method: "POST", path: "/api/records", body: { kind: "upload", fileKey: up.body.data.fileKey, name, mime: "application/pdf", size: bytes.length } });
  const record = made.body?.data?.record || made.body?.data;
  if (record?.id) ctx.cleanup(() => ctx.http({ as, method: "DELETE", path: `/api/records/${record.id}` }));
  return record;
}

export const chatUploadFiled = {
  name: "materials.chat_upload_filed", area: "materials", risk: "write",
  description: "A chat upload is filed in a private folder named from it (an existing one is reused), read, and Undo removes only what that upload made — the folder too when it made it.",
  params: { learner: { default: "@tester18" } },
  async run(ctx, p) {
    // A gate run cut short (a redeploy mid-run) leaves its records behind: clear this test learner's first.
    const me = await ctx.as(p.learner);
    await ctx.db.deleteOwned("edu.records", { ownerColumn: "user_id", ownerId: me.id, filters: { name: { like: "[verify:%" } } }).catch((e) => ctx.note(`sweep skipped: ${e.message}`));
    const m = ctx.marker.replace(/[^a-z0-9]/gi, "").slice(-6);
    const subject = "Biology";
    const names = [`WAEC Biology 2019 Paper 2 ${m}.pdf`];
    const ingest = (body) => ctx.http({ as: p.learner, method: "POST", path: "/api/agent/materials/ingest", body });
    const folderOf = async (id) => ((await ctx.http({ as: p.learner, method: "GET", path: "/api/records/folders" })).body?.data || []).find((f) => f.id === id);

    // 1. The folder is picked before the turn: subject + kind, private, new.
    const a = await ingest({ names, ask: `Help me prepare for ${subject} with this` });
    ctx.expect.status("the upload is received", a, 201);
    const first = a.body?.data;
    if (!first?.id) return;
    ctx.note(`folder: ${first.folder?.name} · kind ${first.kind} · subject ${first.subject}`);
    // Only a folder this run made is ours to delete (the learner may already have "Biology — Past papers").
    if (first.folder?.id && first.folder.created) ctx.cleanup(() => ctx.http({ as: p.learner, method: "DELETE", path: `/api/records/folders/${first.folder.id}` }));
    ctx.expect.eq("it is a past paper", first.kind, "past_paper");
    ctx.expect.ok("filed in '<Subject> — Past papers'", /^biology\w* — past papers$/i.test(first.folder?.name || ""), first.folder);
    ctx.expect.eq("…which is private (D53)", (await folderOf(first.folder?.id))?.visibility, "private");

    // 2. The bytes go up the Library's way; filing puts the record in the folder.
    const rec = await uploadRecord(ctx, p.learner, `${ctx.marker} ${names[0]}`);
    ctx.expect.ok("the record is saved", !!rec?.id);
    if (!rec?.id) return;
    const filed = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/materials/ingest/${first.id}/records`, body: { recordIds: [rec.id] } });
    ctx.expect.eq("filed", filed.body?.data?.state, "filed");
    const items = await ctx.http({ as: p.learner, method: "GET", path: `/api/records/folders/${first.folder.id}/items` });
    ctx.expect.ok("…the record is in the folder", (items.body?.data || []).some((it) => it.itemType === "record" && it.itemRef === rec.id), items.body?.data);

    // 3. Read: the text PDF's pages, then ready. A move the workflow doesn't list is refused.
    let pages = 0;
    for (let i = 0; i < 12; i++) {
      const ext = await ctx.http({ as: p.learner, method: "POST", path: "/api/records/extract/text", body: { recordId: rec.id } });
      if (ext.status !== 202) { pages = ext.body?.data?.pages?.length || 0; break; }
      await sleep(5_000);
    }
    await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/materials/ingest/${first.id}/progress`, body: { state: "extracting" } });
    const ready = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/materials/ingest/${first.id}/progress`, body: { state: "ready", pages } });
    ctx.expect.eq("ready", ready.body?.data?.state, "ready");
    ctx.expect.gte("…with its pages", ready.body?.data?.pages ?? 0, 1);
    const back = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/materials/ingest/${first.id}/progress`, body: { state: "extracting" } });
    ctx.expect.status("ready → extracting is refused (409)", back, 409);

    // 4. A second upload on the same subject reuses the folder.
    const b = await ingest({ names: [`WAEC Biology 2020 Paper 1 ${m}.pdf`], ask: "" });
    const second = b.body?.data;
    ctx.expect.ok("a second upload reuses the folder", second?.folder?.id === first.folder.id && second?.folder?.created === false, second?.folder);
    const rec2 = await uploadRecord(ctx, p.learner, `${ctx.marker} 2020.pdf`);
    if (second?.id && rec2?.id) await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/materials/ingest/${second.id}/records`, body: { recordIds: [rec2.id] } });

    // 5. Undo the second: its record goes, the folder (not its to remove) stays.
    const u2 = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/materials/ingest/${second?.id}/undo` });
    ctx.expect.eq("undone", u2.body?.data?.state, "undone");
    ctx.expect.ok("…its record is gone", !((await ctx.http({ as: p.learner, method: "GET", path: "/api/records" })).body?.data || []).some((r) => r.id === rec2?.id));
    ctx.expect.ok("…the folder it didn't make stays", !!(await folderOf(first.folder.id)));

    // 6. Undo the first: its record and the folder it made go.
    const u1 = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/materials/ingest/${first.id}/undo` });
    const stillThere = !!(await folderOf(first.folder.id));
    ctx.expect.ok(first.folder.created ? "undoing the first removes the folder it made" : "undoing the first keeps the folder that was already there",
      u1.body?.data?.folderRemoved === first.folder.created && stillThere === !first.folder.created, { ingest: u1.body?.data, stillThere });
    ctx.expect.ok("…and its record", !((await ctx.http({ as: p.learner, method: "GET", path: "/api/records" })).body?.data || []).some((r) => r.id === rec.id));
    const after = await ctx.http({ as: p.learner, method: "POST", path: `/api/agent/materials/ingest/${first.id}/progress`, body: { state: "ready" } });
    ctx.expect.status("an undone upload can't move again (409)", after, 409);

    // 7. The study-step chip after an upload.
    const chips = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/suggestions",
      body: { role: "student", ask: "Help me with this", reply: "I've saved it and I'm reading it now.", attachments: [{ name: names[0], kind: "past_paper" }] } });
    ctx.expect.eq("the first chip after a past paper", (chips.body?.suggestions || [])[0], "Find the topics that keep coming up");
  },
};

export const pastPaperStructured = {
  name: "materials.past_paper_structured", area: "materials", risk: "write",
  description: "A past paper dropped into chat is read into topics and its questions (with marks, private), the protégé posts what it found into that chat, the agent's past-paper analysis uses them, and Undo removes them.",
  params: { learner: { default: "@tester18" } },
  async run(ctx, p) {
    const as = p.learner;
    const chat = await ctx.http({ as, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} past paper` } });
    const chatId = chat.body?.session?.id;
    ctx.expect.ok("a chat to post into", !!chatId, chat.body);
    if (!chatId) return;
    ctx.cleanup(() => ctx.http({ as, method: "DELETE", path: `/api/adaptive/chat/sessions/${chatId}` }));
    const name = `${ctx.marker} WAEC Biology 2019 Paper 2.pdf`;
    const a = await ctx.http({ as, method: "POST", path: "/api/agent/materials/ingest", body: { names: [name], ask: "Help me prepare with this paper", chatSessionId: chatId } });
    const ingest = a.body?.data;
    if (!ingest?.id) { ctx.expect.ok("the upload is received", false, a.body); return; }
    if (ingest.folder?.id && ingest.folder.created) ctx.cleanup(() => ctx.http({ as, method: "DELETE", path: `/api/records/folders/${ingest.folder.id}` }));
    const rec = await uploadRecord(ctx, as, name, await pastPaperPdf());
    if (!rec?.id) { ctx.expect.ok("the record is saved", false); return; }
    await ctx.http({ as, method: "POST", path: `/api/agent/materials/ingest/${ingest.id}/records`, body: { recordIds: [rec.id] } });
    let pages = 0;
    for (let i = 0; i < 12; i++) {
      const ext = await ctx.http({ as, method: "POST", path: "/api/records/extract/text", body: { recordId: rec.id } });
      if (ext.status !== 202) { pages = ext.body?.data?.pages?.length || 0; break; }
      await sleep(5_000);
    }
    ctx.expect.eq("the paper's two pages are read", pages, 2);
    await ctx.http({ as, method: "POST", path: `/api/agent/materials/ingest/${ingest.id}/progress`, body: { state: "extracting" } });
    await ctx.http({ as, method: "POST", path: `/api/agent/materials/ingest/${ingest.id}/progress`, body: { state: "ready", pages } });

    // Structure: topics on real pages, the questions with their marks, said back in the chat.
    const since = logSeq();
    const st = await ctx.http({ as, method: "POST", path: `/api/agent/materials/ingest/${ingest.id}/structure` });
    for (const line of readLogs({ since, filter: "materials" }).lines) ctx.note(`log: ${String(line.msg).slice(0, 300)}`);
    const data = st.body?.data;
    ctx.note(`topics: ${(data?.topics || []).join(" · ")} · questions ${data?.questions}`);
    ctx.note(`message: ${String(st.body?.message?.text || "").slice(0, 400)}`);
    ctx.expect.eq("structured, then ready again", data?.state, "ready");
    ctx.expect.gte("topics found", (data?.topics || []).length, 3);
    ctx.expect.ok("…the paper's own topics", (data?.topics || []).some((t) => /osmosis|diffusion/i.test(t)) && (data?.topics || []).some((t) => /ecolog|food|ecosystem/i.test(t)), data?.topics);
    ctx.expect.gte("its questions are found", data?.questions ?? 0, 4);
    const text = String(st.body?.message?.text || "");
    ctx.expect.ok("the protégé says what it found, in that chat", /The paper tests \*\*\d+ topics?\*\*/.test(text) && /marks/.test(text), text);
    ctx.expect.ok("…with the study step first and links to the folder and paper",
      st.body?.message?.meta?.ideas?.[0] === "Make a study plan from this paper" && (st.body?.message?.meta?.materials || []).some((m) => m.href === `/library?record=${rec.id}`), st.body?.message?.meta);
    const msgs = await ctx.http({ as, method: "GET", path: `/api/adaptive/chat/sessions/${chatId}/messages?limit=10` });
    ctx.expect.ok("…saved in the chat", (msgs.body?.messages || []).some((m) => m.id === st.body?.message?.id));
    const again = await ctx.http({ as, method: "POST", path: `/api/agent/materials/ingest/${ingest.id}/structure` });
    ctx.expect.ok("once per upload: a second call posts nothing", again.status === 200 && again.body?.message === null);

    // The agent's analysis reads them — only this learner's.
    const an = await ctx.agent.tool({ as, tool: "analyse_past_papers", input: { subject: "Biology" } });
    ctx.note(`analysis: ${JSON.stringify(an).slice(0, 400)}`);
    ctx.expect.ok("the past-paper analysis uses its questions", (an?.topics || []).some((t) => /osmosis|diffusion/i.test(t.topic) && t.marks > 0), an);

    // Undo takes the questions with it.
    await ctx.http({ as, method: "POST", path: `/api/agent/materials/ingest/${ingest.id}/undo` });
    const after = await ctx.agent.tool({ as, tool: "analyse_past_papers", input: { subject: "Biology" } });
    const before = (an?.topics || []).reduce((n, t) => n + t.questions, 0);
    const left = (after?.topics || []).reduce((n, t) => n + t.questions, 0);
    ctx.expect.ok("…and Undo removes them", left <= before - (data?.questions ?? 0), { before, left });
  },
};
