/**
 * Tailored chips and materials (Reader + Agent Chat), on a test learner:
 * the reader's Learn suggestions are built from the open document and point
 * at its pages; after "you haven't taught me yet" one chip is always the
 * teaching guide; a Library search in Agent Chat yields links that open the
 * record. The uploaded record is deleted afterwards.
 */
import { materialsFrom } from "../../adaptive-learning/chat-materials.js";
import { textPdf } from "./reader.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const tailoredChips = {
  name: "chat.tailored_chips", area: "chat", risk: "write",
  description: "Reader learn suggestions cite the open document's pages; 'not taught yet' always gets an 'Ask your teaching guide' chip; the agent's Library search returns records that become links opening them.",
  params: { learner: { default: "@tester18" } },
  async run(ctx, p) {
    const name = `${ctx.marker} Cell Structure.pdf`;
    const bytes = await textPdf();
    const up = await ctx.http({ as: p.learner, method: "POST", path: "/api/records/upload-url", body: { name, mime: "application/pdf", size: bytes.length } });
    if (up.status !== 200 || !up.body?.data?.uploadUrl) ctx.expect.blocked(`upload-url answered ${up.status}: ${up.body?.message || ""}`);
    const put = await fetch(up.body.data.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes }).catch((e) => ({ status: String(e.message) }));
    if (!(put.status >= 200 && put.status < 300)) ctx.expect.blocked(`the file store refused the upload: ${put.status}`);
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/records", body: { kind: "upload", fileKey: up.body.data.fileKey, name, mime: "application/pdf", size: bytes.length } });
    const record = made.body?.data?.record || made.body?.data;
    ctx.expect.ok("the record is registered", !!record?.id, made.body);
    if (!record?.id) return;
    ctx.cleanup(() => ctx.http({ as: p.learner, method: "DELETE", path: `/api/records/${record.id}` }));
    for (let i = 0; i < 12; i++) {
      const ext = await ctx.http({ as: p.learner, method: "POST", path: "/api/records/extract/text", body: { recordId: record.id } });
      if (ext.status !== 202) break;
      await sleep(5_000);
    }

    // 1. Reader: learn suggestions from the document, each pointing at a page.
    let learn = null;
    for (let i = 0; i < 4; i++) {
      learn = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/learn-suggestions",
        body: { topic: "Cell structure", subject: "Biology", title: name, document: { recordId: record.id } } });
      if ((learn.body?.cited || []).some((x) => x.citation)) break;
      await sleep(10_000);
    }
    const cited = learn?.body?.cited || [];
    ctx.note(`learn: ${JSON.stringify(cited).slice(0, 600)}`);
    ctx.expect.gte("learn suggestions from the document", cited.length, 3);
    ctx.expect.ok("…most point at a page of it", cited.filter((x) => x.citation?.pageNumber >= 1).length >= 2, cited);
    ctx.expect.ok("…and name what is in it", cited.some((x) => /cell wall|mitochondri|nucleus|osmosis|respiration|chromosome|dna/i.test(x.text)), cited);

    // 2. Agent Chat: not taught yet → the teaching guide chip, first.
    const nt = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/suggestions",
      body: { role: "student", ask: "What is osmosis?", reply: "You haven't taught me osmosis yet, so I can't explain it properly.", tools: [{ tool: "ask_to_be_taught", topic: "Osmosis" }] } });
    const chips = nt.body?.suggestions || [];
    ctx.note(`not-taught chips: ${JSON.stringify(chips)}`);
    ctx.expect.status("suggestions answer 200", nt, 200);
    ctx.expect.ok("the first chip consults the teaching guide", /teaching guide/i.test(String(chips[0]?.label || chips[0] || "")), chips);
    const plain = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/suggestions",
      body: { role: "student", ask: "What do mitochondria do?", reply: "Mitochondria are where aerobic respiration releases energy from glucose." } });
    ctx.expect.ok("…and only then (a taught answer gets no guide chip)", !(plain.body?.suggestions || []).some((c) => /teaching guide/i.test(String(c?.label || c))), plain.body?.suggestions);

    // 3. Library search → links that open the record.
    let found = null;
    for (let i = 0; i < 4; i++) {
      found = await ctx.agent.tool({ as: p.learner, tool: "search_my_library", input: { query: "mitochondria" } });
      if ((found?.records || []).some((r) => r.recordId === record.id)) break;
      await sleep(10_000);
    }
    const mats = materialsFrom("search_my_library", found).filter(Boolean);
    ctx.expect.ok("the agent finds the record in the Library", mats.some((m) => m.href === `/library?record=${record.id}`), found);
    const turn = await ctx.agent.chat({ as: p.learner, prompt: "Do I have any notes in my library about mitochondria?" });
    ctx.expect.ok("Agent Chat searches the Library for it", turn.tools.some((t) => t.tool === "search_my_library"), turn.tools.map((t) => t.tool));
  },
};
