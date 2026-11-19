/**
 * Study material made in Agent Chat (records/studyMaterial.js, make_study_material):
 *   study_material.quiz_from_folder  "Create a quiz on the basic science material in my folder" →
 *       the quiz is built from the document in that folder, saved as a reader tab,
 *       and the reply's card links to /library?record=…&artifact=…
 *   study_material.folder_asks       a folder with several documents and nothing to choose by →
 *       the agent asks which one; each choice is a chip that sends the choice as a reply
 * Everything is deleted afterwards (records, folder, saved tabs go with the record).
 */
import { textPdf } from "./reader.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LEARNER = "@tester18";

async function uploadPdf(ctx, as, name) {
  const bytes = await textPdf();
  const up = await ctx.http({ as, method: "POST", path: "/api/records/upload-url", body: { name, mime: "application/pdf", size: bytes.length } });
  if (up.status !== 200 || !up.body?.data?.uploadUrl) ctx.expect.blocked(`upload-url answered ${up.status}: ${up.body?.message || ""}`);
  const put = await fetch(up.body.data.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes }).catch((e) => ({ status: String(e.message) }));
  if (!(put.status >= 200 && put.status < 300)) ctx.expect.blocked(`the file store refused the upload: ${put.status}`);
  const made = await ctx.http({ as, method: "POST", path: "/api/records", body: { kind: "upload", fileKey: up.body.data.fileKey, name, mime: "application/pdf", size: bytes.length } });
  const record = made.body?.data?.record || made.body?.data;
  if (!record?.id) ctx.expect.blocked(`the record wasn't registered: ${made.status}`);
  ctx.cleanup(() => ctx.http({ as, method: "DELETE", path: `/api/records/${record.id}` }));
  let ext = null;
  for (let i = 0; i < 12; i++) {
    ext = await ctx.http({ as, method: "POST", path: "/api/records/extract/text", body: { recordId: record.id } });
    if (ext.status !== 202) break;
    await sleep(5_000);
  }
  if (ext?.status !== 200) ctx.expect.blocked(`the document's text wasn't read: ${ext?.status}`);
  return record;
}

async function folderWith(ctx, as, name, records) {
  const f = await ctx.http({ as, method: "POST", path: "/api/records/folders", body: { name } });
  const folder = f.body?.data?.folder || f.body?.data;
  if (!folder?.id) ctx.expect.blocked(`the folder wasn't made: ${f.status} ${f.body?.message || ""}`);
  ctx.cleanup(() => ctx.http({ as, method: "DELETE", path: `/api/records/folders/${folder.id}` }));
  for (const r of records) {
    const add = await ctx.http({ as, method: "POST", path: "/api/records/folders/items", body: { folderIds: [folder.id], itemType: "record", itemRef: r.id, title: r.name, kind: "pdf" } });
    if (add.status >= 300) ctx.expect.blocked(`couldn't add to the folder: ${add.status} ${add.body?.message || ""}`);
  }
  return folder;
}

export const quizFromFolder = {
  name: "study_material.quiz_from_folder", area: "materials", risk: "write", timeoutMs: 300_000,
  description: "\"Create a quiz on the basic science material in my folder\": the quiz is built from the folder's document, saved as a reader tab, and the reply's card opens the reader on it.",
  params: { learner: { default: LEARNER } },
  async run(ctx, p) {
    await ctx.as(p.learner);
    const folderName = `${ctx.marker} Basic Science`;
    const record = await uploadPdf(ctx, p.learner, `${ctx.marker} Cells and energy.pdf`);
    await folderWith(ctx, p.learner, folderName, [record]);

    // 1. The tool itself.
    const r = await ctx.agent.tool({ as: p.learner, tool: "make_study_material", input: { tool: "quiz", folder: folderName, count: "5" } });
    ctx.note(`tool: ${JSON.stringify(r).slice(0, 300)}`);
    ctx.expect.ok("made from the folder's document", r?.made === true && r?.recordId === record.id, r);
    ctx.expect.ok("…links to the reader on its saved tab", new RegExp(`^/library\\?record=${record.id}&artifact=[0-9a-f-]{36}$`).test(r?.href || ""), r?.href);
    const list = await ctx.http({ as: p.learner, path: `/api/records/artifacts?recordId=${record.id}` });
    const tab = (list.body?.data?.artifacts || []).find((a) => a.id === r?.artifactId);
    ctx.expect.eq("saved as a quiz tab on the document", tab?.kind, "quiz");
    const qs = tab?.content?.quizQuestions || [];
    ctx.expect.ok("…with questions, each citing a page", qs.length >= 3 && qs.every((q) => q.cite && Number.isInteger(q.cite.page)), qs.slice(0, 2));
    ctx.expect.ok("…and fresh answer slots, open in the reader", tab?.open === true && (tab?.content?.ui?.quizAnswers || []).length === qs.length);

    // 2. The whole chat turn: the agent picks the tool, the reply carries the card.
    const turn = await ctx.agent.chat({ as: p.learner, mode: "live", prompt: `Create a quiz on the basic science material in my folder "${folderName}"` });
    const used = (turn.tools || []).find((t) => t.tool === "make_study_material");
    ctx.note(`turn tools: ${(turn.tools || []).map((t) => t.tool).join(", ")} · reply: ${String(turn.reply || turn.text || "").slice(0, 200)}`);
    ctx.expect.ok("the agent calls make_study_material", !!used, (turn.tools || []).map((t) => t.tool));
    const { materialsFrom } = await import("../../adaptive-learning/index.js");
    const card = materialsFrom("make_study_material", used?.result || {}).find((m) => m?.kind === "study_output");
    ctx.expect.ok("the reply carries the quiz card (opens the reader on its tab)", !!card && /^Quiz · /.test(card.title) && /&artifact=/.test(card.href || ""), used?.result);
  },
};

export const folderAsks = {
  name: "study_material.folder_asks", area: "materials", risk: "write", timeoutMs: 300_000,
  description: "A folder with several documents and nothing to choose by: the agent asks which one, and each document is a chip that sends the choice.",
  params: { learner: { default: LEARNER } },
  async run(ctx, p) {
    await ctx.as(p.learner);
    const folderName = `${ctx.marker} Science pack`;
    const a = await uploadPdf(ctx, p.learner, `${ctx.marker} Part A.pdf`);
    const b = await uploadPdf(ctx, p.learner, `${ctx.marker} Part B.pdf`);
    await folderWith(ctx, p.learner, folderName, [a, b]);
    const r = await ctx.agent.tool({ as: p.learner, tool: "make_study_material", input: { tool: "flashcards", folder: folderName } });
    ctx.note(`tool: ${JSON.stringify(r).slice(0, 300)}`);
    ctx.expect.ok("it asks which document (nothing made)", r?.needsChoice === true && !r?.made, r);
    ctx.expect.eq("…offering both", (r?.records || []).length, 2);
    const { materialsFrom } = await import("../../adaptive-learning/index.js");
    const chips = materialsFrom("make_study_material", r);
    ctx.expect.ok("each is a chip that sends the choice", chips.length === 2 && chips.every((c) => c.kind === "choice" && /^Make the flashcards from /.test(c.action?.text || "")), chips);
  },
};

export const STUDY_MATERIAL = [quizFromFolder, folderAsks];
