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
  // The paper is read (one model pass) and a Study Prep plans from it in the background (up to 10 decisions).
  timeoutMs: 480_000,
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
    // 2026-10-19: each step is in the chat — a tool row and a short message, written from what it returned.
    const stepIds = (x) => (x?.steps || []).map((st) => st.id.split(":")[0] + (st.type === "message" ? ":say" : ""));
    ctx.expect.ok("steps: the file sorted and its folder chosen, each said", ["sort", "sort:say", "folders", "folders:say"].every((k) => stepIds(ingest).includes(k)), ingest.steps);
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
    ctx.note(`steps: ${(data?.steps || []).map((x) => (x.type === "tool" ? `[${x.headline} → ${x.result}]` : `"${x.text}"`)).join(" ").slice(0, 900)}`);
    ctx.expect.ok("steps: filed, then read (what it found) and said", ["filed", "read"].every((k) => stepIds(data).includes(k)) && (data?.steps || []).some((x) => x.id.startsWith("read:") && x.type === "message"), data?.steps);
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

    // Find similar (D52): only Akoro's own courses and posts, each saying why; only what was offered goes in.
    const sim = await ctx.http({ as, method: "POST", path: `/api/agent/materials/ingest/${ingest.id}/similar` });
    const cands = sim.body?.candidates || [];
    ctx.note(`similar: ${cands.map((c) => `${c.kind}:${c.title} (${c.why})`).join(" · ") || "(none on the sandbox)"}`);
    ctx.expect.eq("offering similar material", sim.body?.data?.state, "offering_more");
    ctx.expect.ok("steps: the similar search and what it found, said", ["similar", "similar:say"].every((k) => stepIds(sim.body?.data).includes(k)), sim.body?.data?.steps);
    ctx.expect.ok("…only Akoro courses and blog posts, each with an in-app link and why",
      cands.every((c) => ["course", "blog"].includes(c.kind) && /^\/(course|blog)\//.test(c.href) && c.why), cands);
    const add = await ctx.http({ as, method: "POST", path: `/api/agent/materials/ingest/${ingest.id}/similar/add`, body: { keys: [...cands.slice(0, 1).map((c) => c.key), "blog:not-offered"] } });
    ctx.expect.eq("…added, back to ready", add.body?.data?.state, "ready");
    ctx.expect.ok("…only what was offered goes in", (add.body?.added || []).every((a) => a.key !== "blog:not-offered") && (add.body?.added || []).length === Math.min(1, cands.length), add.body?.added);
    if (ingest.folder?.id && cands.length) {
      const items = (await ctx.http({ as, method: "GET", path: `/api/records/folders/${ingest.folder.id}/items` })).body?.data || [];
      ctx.expect.ok("…into the folder", items.some((it) => it.itemRef === cands[0].key), items);
    }

    // Study Prep from the folder (§7.17.3): the plan uses only its topics, the session records the folder.
    const me = await ctx.as(as);
    const spBase = "/api/adaptive/study-prep/sessions";
    await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: "[verify:%" } } });
    const active = await ctx.http({ as, path: spBase });
    if (active.body?.session?.id) await ctx.http({ as, method: "POST", path: `${spBase}/${active.body.session.id}/cancel`, body: {} });
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));
    const sp = await ctx.agent.tool({ as, tool: "start_study_prep_session", mode: "live",
      input: { goal: `${ctx.marker} WAEC Biology from my past paper`, from_materials: true, folder: data?.folder?.name || ingest.folder?.name } });
    ctx.note(`study prep: ${JSON.stringify({ from: sp?.from, status: sp?.status, plan: (sp?.plan || []).map((t) => t.label) }).slice(0, 400)}`);
    ctx.expect.ok("Study Prep plans from the folder", !!sp?.from && /past papers/i.test(sp.from), sp);
    // Planning runs in the background (the card streams it): wait for the plan (≤ 4 min).
    let plan = sp?.plan || [];
    for (let i = 0; i < 48 && sp?.sessionId && !plan.length; i++) {
      await sleep(5_000);
      const v = await ctx.http({ as, path: `${spBase}/${sp.sessionId}` });
      if (v.body?.session?.status === "awaiting_confirmation" || v.body?.session?.status === "paused") plan = v.body.session.plan || [];
      if (v.body?.session?.status === "paused") break;
    }
    ctx.note(`plan: ${plan.map((t) => t.label).join(" · ")}`);
    const topicSet = new Set((data?.topics || []).map((t) => t.toLowerCase()));
    ctx.expect.ok("…its plan uses only the paper's topics", plan.length > 0 && plan.every((t) => topicSet.has(String(t.label).toLowerCase())), { plan, topics: data?.topics });
    const [row] = await ctx.db.rows("edu.study_prep_sessions", { learner_id: me.id, goal: { like: `${ctx.marker}%` } }, { columns: "syllabus_source, syllabus_ref, entry_mode", limit: 1 });
    ctx.expect.ok("…and the session records the folder as its syllabus", row?.syllabus_source === "documents" && row?.syllabus_ref === (data?.folder?.id || ingest.folder?.id) && row?.entry_mode === "material", row);
    if (sp?.sessionId) await ctx.http({ as, method: "POST", path: `${spBase}/${sp.sessionId}/cancel`, body: {} });

    // Undo takes the questions with it.
    await ctx.http({ as, method: "POST", path: `/api/agent/materials/ingest/${ingest.id}/undo` });
    const after = await ctx.agent.tool({ as, tool: "analyse_past_papers", input: { subject: "Biology" } });
    const before = (an?.topics || []).reduce((n, t) => n + t.questions, 0);
    const left = (after?.topics || []).reduce((n, t) => n + t.questions, 0);
    ctx.expect.ok("…and Undo removes them", left <= before - (data?.questions ?? 0), { before, left });
  },
};

// Sorting (§7.17, D51): files sent together go to their own subjects, into the
// folders the learner already keeps — a new folder only when none fits.
export const sortOwnFolders = {
  name: "materials.sort_own_folders", area: "materials", risk: "write",
  description: "Files sent together are sorted per subject: Agric papers into the learner's own 'Agric' folder (no new folder), Commerce notes into their own; two Agric folders → the card asks and the pick is remembered; Undo on one card leaves the other; Restore brings it back; Recently deleted lists it and Delete forever doesn't wait.",
  params: { learner: { default: "@tester18" } },
  async run(ctx, p) {
    const as = p.learner;
    const me = await ctx.as(as);
    const m = ctx.marker.replace(/[^a-z0-9]/gi, "").slice(-6);
    const api = "/api/agent/materials/ingest";
    const ingest = async (names, ask = "") => (await ctx.http({ as, method: "POST", path: api, body: { names, ask } })).body || {};
    const made = new Set();   // folders this run made: removed at the end
    ctx.cleanup(async () => {
      const all = (await ctx.http({ as, path: "/api/records/folders" })).body?.data || [];
      for (const f of all) if (made.has(f.id) || f.name.includes(m)) await ctx.http({ as, method: "DELETE", path: `/api/records/folders/${f.id}` });
    });
    const ingestIds = [];
    ctx.cleanup(() => Promise.all(ingestIds.map((id) => ctx.db.deleteOwned("edu.material_ingests", { ownerColumn: "user_id", ownerId: me.id, filters: { id } }))));
    ctx.cleanup(() => ctx.db.deleteOwned("edu.material_folder_defaults", { ownerColumn: "user_id", ownerId: me.id, filters: { subject_key: "agricultural science" } }));
    await ctx.db.deleteOwned("edu.material_folder_defaults", { ownerColumn: "user_id", ownerId: me.id, filters: { subject_key: "agricultural science" } }).catch(() => {});
    const folder = async (name) => {
      const r = await ctx.http({ as, method: "POST", path: "/api/records/folders", body: { name } });
      if (!r.body?.data?.id) ctx.expect.blocked(`making the folder "${name}" answered ${r.status}`);
      made.add(r.body.data.id);
      return r.body.data;
    };

    // 1. The learner keeps Agric in their own folder, named their way.
    const agric = await folder(`Agric ${m}`);
    const batch = await ingest([`WAEC Agric 2019 ${m}.pdf`, `WAEC Agricultural Science 2021 ${m}.pdf`, `Commerce notes ${m}.docx`], "my papers and notes for this term");
    const ups = batch.ingests || [];
    ups.forEach((u) => ingestIds.push(u.id));
    ctx.note(`batch: ${JSON.stringify(ups.map((u) => [u.names, u.subject, u.kind, u.folder?.name, u.folder?.created]))}`);
    ctx.expect.eq("three files, two subjects → two uploads", ups.length, 2);
    const ag = ups.find((u) => /agric/i.test(u.names?.[0] || ""));
    const co = ups.find((u) => /commerce/i.test(u.names?.[0] || ""));
    ctx.expect.ok("…one batch", !!batch.batchId && ups.every((u) => u.batchId === batch.batchId), { batchId: batch.batchId });
    ctx.expect.ok("both Agric papers go to the learner's own 'Agric' folder — no new folder", ag?.folder?.id === agric.id && ag?.folder?.created === false && ag?.names?.length === 2, ag);
    ctx.expect.ok("the Commerce notes go to a Commerce folder of their own", /^commerce — notes$/i.test(co?.folder?.name || "") && co?.folder?.id !== agric.id, co?.folder);
    if (co?.folder?.created) made.add(co.folder.id);

    // 2. Two folders fit equally → the card asks (the fuller first); the pick is remembered.
    const ss2 = await folder(`SS2 Agric ${m}`);
    const ask = (await ingest([`Agric notes ${m}.docx`])).ingests?.[0];
    if (ask?.id) ingestIds.push(ask.id);
    ctx.expect.ok("two Agric folders → it asks which, the fuller one first", ask?.folder === null && (ask?.choices || [])[0]?.id === agric.id && ask.choices.some((c) => c.id === ss2.id), { folder: ask?.folder, choices: ask?.choices });
    const picked = await ctx.http({ as, method: "POST", path: `${api}/${ask?.id}/folder`, body: { folderId: ss2.id } });
    ctx.expect.ok("…the learner picks 'SS2 Agric'", picked.body?.data?.folder?.id === ss2.id && !picked.body?.data?.choices, picked.body?.data);
    const next = (await ingest([`Agric notes week 2 ${m}.docx`])).ingests?.[0];
    if (next?.id) ingestIds.push(next.id);
    ctx.expect.eq("…and the next Agric notes go straight there", next?.folder?.id, ss2.id);

    // 3. Undo one card: Recently deleted (restorable); the other card is untouched.
    const undo = await ctx.http({ as, method: "POST", path: `${api}/${co?.id}/undo` });
    ctx.expect.eq("Undo on the Commerce card", undo.body?.data?.state, "undone");
    ctx.expect.ok("…restorable for 30 days", !!undo.body?.data?.restorableUntil && Date.parse(undo.body.data.restorableUntil) - Date.now() > 29 * 86_400_000, undo.body?.data?.restorableUntil);
    const agAfter = await ctx.http({ as, path: `${api}/${ag?.id}` });
    ctx.expect.ok("…the Agric card is untouched", agAfter.body?.data?.state !== "undone" && agAfter.body?.data?.folder?.id === agric.id, agAfter.body?.data);
    const revive = await ctx.http({ as, method: "POST", path: `${api}/${co?.id}/progress`, body: { state: "ready" } });
    ctx.expect.status("a late reading step doesn't bring it back (409)", revive, 409);

    // 4. Restore: back, in a Commerce folder again.
    const back = await ctx.http({ as, method: "POST", path: `${api}/${co?.id}/restore` });
    ctx.expect.ok("Restore brings it back", back.body?.data?.state === "ready" && /^commerce — notes$/i.test(back.body?.data?.folder?.name || "") && !back.body?.data?.restorableUntil, back.body?.data);
    if (back.body?.data?.folder?.id && (co?.folder?.created || undo.body?.data?.folderRemoved)) made.add(back.body.data.folder.id);

    // 5. Recently deleted lists what's undone (not what's restored); Delete forever doesn't wait.
    const listed = async () => ((await ctx.http({ as, path: "/api/agent/materials/deleted" })).body?.items || []).map((x) => x.id);
    await ctx.http({ as, method: "POST", path: `${api}/${next?.id}/undo` });
    const inList = await listed();
    ctx.expect.ok("Recently deleted lists the undone upload, not the restored one", inList.includes(next?.id) && !inList.includes(co?.id), inList);
    const gone = await ctx.http({ as, method: "POST", path: `${api}/${next?.id}/purge` });
    ctx.expect.ok("Delete forever: gone for good, off the list", gone.body?.data?.purged === true && !(await listed()).includes(next?.id), gone.body?.data);
    const late = await ctx.http({ as, method: "POST", path: `${api}/${next?.id}/restore` });
    ctx.expect.status("…and can't be restored (410)", late, 410);
  },
};

/* ── Diagnostic: several files in one chat message ─────────────────────── */
// Read-only (2026-10-25: "more than one upload on chat, only one file extracted
// and parsed"). The newest uploads that carried 2+ files, and what became of
// each file: saved as a record, pages extracted, read by the structure step.
// Counts and ids only — never a file name or its text.
export const materialsMultiFileDiag = {
  name: "materials.multi_file_diag", area: "materials", risk: "read",
  description: "Diagnostic: for the newest chat uploads with 2+ files, how many files became records, how many have extracted pages, and how many the structure step read — per upload, counts and ids only.",
  async run(ctx) {
    const { default: db } = await import("../../../db.js");
    const { getExtraction } = await import("../../records/extractLib.js");
    const edu = () => db.schema("edu");
    const { data: rows, error } = await edu().from("material_ingests")
      .select("id, state, names, record_ids, structure, created_at, folder_id").order("created_at", { ascending: false }).limit(200);
    if (error) ctx.expect.blocked(`material_ingests: ${error.message}`);
    // A message's files may be split into several uploads (one per folder): group by message via chat_message_id is not selected — count per upload, and also per sibling batch (same created second).
    const multi = (rows || []).filter((r) => (r.names || []).length >= 2).slice(0, 12);
    ctx.note(`${(rows || []).length} recent uploads · ${multi.length} with 2+ files`);
    const split = (rows || []).filter((r, i, all) => all.some((o) => o.id !== r.id && Math.abs(new Date(o.created_at) - new Date(r.created_at)) < 1500)).length;
    ctx.note(`${split} uploads were created within 1.5 s of another (one message split into folders)`);
    for (const r of multi) {
      const ids = r.record_ids || [];
      const { data: recs } = ids.length ? await edu().from("records").select("id, kind, mime, file_key").in("id", ids) : { data: [] };
      const perFile = [];
      for (const rec of recs || []) {
        const ext = rec.file_key ? await getExtraction(rec.file_key).catch(() => ({ pages: [] })) : { pages: [] };
        const pages = (ext.pages || []).filter((p) => String(p.markdown || "").trim()).length;
        perFile.push(`${String(rec.mime || rec.kind).replace(/^application\//, "")}:${pages}p`);
      }
      const read = Array.isArray(r.structure?.items) ? r.structure.items.length : (r.structure ? "?" : 0);
      ctx.note(`${r.id.slice(0, 8)} ${r.created_at.slice(0, 16)} · ${r.state} · files named ${(r.names || []).length} · records ${ids.length} · pages per file [${perFile.join(", ")}] · structured ${read}`);
    }
    ctx.expect.ok("diagnostic ran", true);
  },
};
