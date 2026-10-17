// Suggestion chips through their real REST routes, as a test learner (risk:
// write — each is one small billed model call). An empty list is how both
// routes report a failure, so the server's own warning lines ride along as
// evidence.
import { readLogs, logSeq } from "../../../lib/logTap.js";

const CELL = "The cell wall is a rigid layer outside the cell membrane of plant cells. It gives the cell its shape and stops it bursting " +
  "when water enters by osmosis. Mitochondria are the sites of aerobic respiration and release the energy stored in glucose.";

export const suggestionsAnswer = {
  name: "chat.suggestions_answer", area: "chat", risk: "write",
  description: "Agent Chat follow-up chips and the guide chat's Learn suggestions come back non-empty and about the material.",
  params: { learner: { default: "@tester17" } },
  async run(ctx, p) {
    const since = logSeq();
    const follow = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/suggestions",
      body: { ask: "What does the cell wall do?", reply: CELL } });
    const learn = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/learn-suggestions",
      body: { topic: "Cell structure", subject: "Biology", title: "BIO 111 Cell Structure", excerpt: CELL } });
    for (const line of readLogs({ since, filter: "suggestions" }).lines) ctx.note(`log: ${String(line.msg).slice(0, 300)}`);
    ctx.expect.status("follow-ups answer 200", follow, 200);
    ctx.expect.gte("follow-up chips", follow.body?.suggestions?.length ?? 0, 2);
    ctx.expect.status("learn suggestions answer 200", learn, 200);
    const items = learn.body?.suggestions || [];
    ctx.expect.gte("learn suggestions", items.length, 3);
    ctx.expect.ok("learn suggestions name the material", items.some((s) => /cell|mitochondri|osmosis|respiration/i.test(s)), JSON.stringify(items));
  },
};
