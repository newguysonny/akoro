/**
 * Materials to study (Grand Plan §7.17, D51–D53), on a test learner: a file
 * dropped into chat is filed in a private Library folder named from it, read,
 * and Undo removes exactly what the upload made. Everything is deleted.
 */
import { textPdf } from "./reader.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function uploadRecord(ctx, as, name) {
  const bytes = await textPdf();
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
    const m = ctx.marker.replace(/[^a-z0-9]/gi, "").slice(-6);
    const subject = `Biology${m}`;   // a subject name unique to this run, so the folder is new
    const names = [`WAEC ${subject} 2019 Paper 2.pdf`];
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
    const b = await ingest({ names: [`WAEC ${subject} 2020 Paper 1.pdf`], ask: "" });
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
