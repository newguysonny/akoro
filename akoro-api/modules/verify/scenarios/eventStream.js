// Phase 3 (Grand Plan §7.9): a Study Prep session's steps are one v3 stream —
// replayed after any sequence, learner-safe, owner-only — and the SSE stream
// replays the gap, says caught_up, then delivers a new step live.
import { signInternalAccess } from "../../auth/index.js";

const API_BASE = process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

/** Read an SSE stream until `until(events)` or the timeout; returns the parsed events. */
async function readSse(url, token, { until, ms = 15_000, onOpen } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const events = [];
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" }, signal: ac.signal });
    if (!r.ok || !r.body) return { status: r.status, events };
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let opened = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        let name = "message", data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) name = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (data) events.push({ name, data: JSON.parse(data) });
        if (name === "caught_up" && !opened) { opened = true; await onOpen?.(); }
      }
      if (until(events)) break;
    }
    return { status: r.status, events };
  } catch (e) {
    if (e.name === "AbortError") return { status: 200, events, timedOut: true };
    throw e;
  } finally { clearTimeout(timer); ac.abort(); }
}

export const eventStream = {
  name: "workflow.event_stream", area: "study-prep", risk: "write",
  description: "A Study Prep session's steps are one v3 event stream: replay after any sequence returns only what came after, in order, each narrated in learner words with no raw facts; another learner gets 404; the SSE stream replays the gap, says caught_up, then delivers the next step live.",
  params: { learner: { default: "@tester16" }, other: { default: "@tester17" }, subject: { default: "Basic Science" }, classLevel: { default: "JSS3" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    await ctx.as(p.other);
    const { getWorkflowHarness } = await import("../../adaptive-learning/study-prep/wiring.js");
    const harness = getWorkflowHarness();
    const active = await ctx.http({ as: p.learner, path: "/api/adaptive/study-prep/sessions" });
    if (active.body?.session?.id) await harness.cancelSession({ sessionId: active.body.session.id, learnerId: me.id }).catch(() => {});
    ctx.cleanup(() => ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { goal: { like: `${ctx.marker}%` } } }));

    const session = await harness.createSession({ learnerId: me.id, goal: `${ctx.marker} Revise ${p.subject}`, subject: p.subject, classLevel: p.classLevel, examBoard: "BECE" });
    const link = await ctx.http({ as: p.learner, path: `/api/workflows/study-prep/${session.id}` });
    const wfId = link.body?.workflowId;
    if (!wfId) ctx.expect.blocked(`no workflow for the session (${link.status}) — is migrations/2026-workflow-engine.sql applied?`);
    ctx.cleanup(() => ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: wfId } }));
    const syllabus = await harness.resolveSyllabus({ sessionId: session.id, learnerId: me.id });
    if (!syllabus.found || !syllabus.topics.length) ctx.expect.blocked(`no ${p.classLevel} ${p.subject} syllabus to plan from`);
    await harness.proposePlan({ sessionId: session.id, learnerId: me.id, topicIds: [syllabus.topics[0].id] });

    const all = await ctx.http({ as: p.learner, path: `/api/workflows/${wfId}/events?after=-1` });
    const evs = all.body?.events || [];
    ctx.note(`${evs.length} learner-visible events: ${evs.map((e) => e.type).join(", ")}`);
    ctx.expect.eq("replay answers", all.status, 200);
    ctx.expect.ok("it starts with workflow.created", evs[0]?.type === "workflow.created");
    ctx.expect.ok("in sequence order", evs.every((e, i) => i === 0 || e.sequence > evs[i - 1].sequence));
    ctx.expect.ok("every event is v3 and narrated", evs.length > 1 && evs.every((e) => e.v === 3 && e.narration?.headline));
    ctx.expect.ok("no raw facts or tool arguments reach the learner", evs.every((e) => e.payload?.facts === undefined && e.payload?.args === undefined));
    ctx.expect.ok("the plan check is there in learner words", evs.some((e) => e.payload?.decisionNode === "plan_validated" && e.narration.headline === "Plan checked"));

    const mid = evs[Math.floor(evs.length / 2)].sequence;
    const later = await ctx.http({ as: p.learner, path: `/api/workflows/${wfId}/events?after=${mid}` });
    ctx.expect.ok("after=N returns only what came after N", (later.body?.events || []).every((e) => e.sequence > mid) && later.body.events.length === evs.filter((e) => e.sequence > mid).length);
    const other = await ctx.http({ as: p.other, path: `/api/workflows/${wfId}/events` });
    ctx.expect.eq("another learner can't read it", other.status, 404);

    const token = signInternalAccess({ id: me.id, role: "student" }, 120);
    const live = await readSse(`${API_BASE}/api/workflows/${wfId}/stream?after=${mid}`, token, {
      // Once caught up, a new step happens: the learner confirms the plan.
      onOpen: () => harness.confirmPlan({ sessionId: session.id, learnerId: me.id }),
      until: (list) => list.some((e) => e.name === "workflow_event" && e.data.payload?.decisionNode === "plan_confirmed"),
    });
    const names = live.events.map((e) => e.name);
    const replayed = live.events.slice(0, names.indexOf("caught_up")).map((e) => e.data.sequence);
    ctx.note(`stream: ${live.events.length} events${live.timedOut ? " (timed out)" : ""}`);
    ctx.expect.ok("the stream replays the gap first, in order", replayed.length > 0 && replayed.every((s, i) => s > mid && (i === 0 || s > replayed[i - 1])));
    ctx.expect.ok("then says caught_up", names.includes("caught_up"));
    ctx.expect.ok("then delivers the new step live", live.events.some((e) => e.name === "workflow_event" && e.data.payload?.decisionNode === "plan_confirmed"));
    await harness.cancelSession({ sessionId: session.id, learnerId: me.id }).catch(() => {});
  },
};
