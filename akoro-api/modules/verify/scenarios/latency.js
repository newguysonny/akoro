/**
 * chat.latency — where a chat turn's time goes (realtime work, 2026-11-07).
 * Sends three typical messages as a test learner over the real streaming route
 * and reads each turn's server timings (metadata.timings): every preparation
 * step, the first thing the learner sees (firstVisibleMs) and the total. A
 * measurement first: it fails only when a turn breaks or the first visible
 * output takes longer than the budget (param, default 6 s).
 */
const PROMPTS = ["hi", "what's due today?", "explain photosynthesis in two sentences"];

function sseEvents(text) {
  const out = [];
  for (const block of String(text || "").split("\n\n")) {
    const ev = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (!ev || !data) continue;
    try { out.push({ event: ev, data: JSON.parse(data) }); } catch { /* skip */ }
  }
  return out;
}

export const chatLatency = {
  name: "chat.latency", area: "agent-chat", risk: "write",
  description: "Times three chat turns end to end over the streaming route: each preparation step, the first visible output, the total. Fails when a turn breaks or the first output is slower than the budget.",
  params: { learner: { default: "@tester22" }, firstVisibleBudgetMs: { default: 6000 } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    ctx.cleanup(() => ctx.db.deleteOwned("chat_sessions", { ownerColumn: "user_id", ownerId: me.id, filters: { title: { like: `${ctx.marker}%` } } }));
    const made = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/sessions", body: { title: `${ctx.marker} latency` } });
    const conversationId = made.body?.data?.id || made.body?.session?.id || made.body?.id || null;
    if (!conversationId) ctx.expect.blocked(`couldn't open a chat: ${made.status} ${JSON.stringify(made.body).slice(0, 160)}`);
    const rows = [];
    for (const prompt of PROMPTS) {
      const res = await ctx.http({ as: p.learner, method: "POST", path: "/api/adaptive/chat/agent?stream=1", headers: { Accept: "text/event-stream" },
        body: { message: prompt, history: [], inlineSuggestions: true, conversationId } });
      const events = sseEvents(typeof res.body === "string" ? res.body : "");
      const done = events.find((e) => e.event === "done")?.data;
      const t = done?.metadata?.timings || {};
      rows.push({ prompt, status: res.status, roundTripMs: res.ms, suggestions: events.some((e) => e.event === "suggestions"), ...t });
      ctx.note(`"${prompt}": round trip ${res.ms} ms · ${JSON.stringify(t)}`);
      ctx.expect.ok(`"${prompt}" answered`, res.status === 200 && !!done?.reply, { status: res.status, events: events.map((e) => e.event).slice(0, 12) });
    }
    const slowest = Math.max(...rows.map((r) => r.firstVisibleMs ?? r.totalMs ?? 0));
    ctx.note(`slowest first visible output: ${slowest} ms (budget ${p.firstVisibleBudgetMs} ms)`);
    ctx.expect.ok("every turn shows something within the budget", slowest <= Number(p.firstVisibleBudgetMs), rows);
  },
};
