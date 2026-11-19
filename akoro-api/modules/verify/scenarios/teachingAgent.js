/**
 * Phases 6–7 on a live server: the agent-driven teaching turn over the real
 * WebSocket (TeachAgentModal's path), the guide mode, and the Study Prep
 * handoff's outcomes — abandon, objective not met, and closing the app then
 * reopening the workflow (Scenario B's resume leg).
 */
import { io } from "socket.io-client";
import { signInternalAccess } from "../../auth/index.js";

const API_BASE = process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const once = (socket, event, ms) => new Promise((resolve) => {
  const t = setTimeout(() => { socket.off(event, on); socket.off("error", onErr); resolve({ timeout: true }); }, ms);
  const on = (d) => { clearTimeout(t); socket.off("error", onErr); resolve({ data: d }); };
  const onErr = (e) => { clearTimeout(t); socket.off(event, on); resolve({ error: e?.message || String(e) }); };
  socket.once(event, on);
  socket.once("error", onErr);
});
async function connect(user) {
  const token = signInternalAccess({ id: user.id, role: user.role || "student" }, 900);
  const socket = io(API_BASE, { transports: ["websocket"], auth: { token }, reconnection: false, timeout: 15_000 });
  const ok = await new Promise((resolve) => { socket.once("connect", () => resolve(true)); socket.once("connect_error", () => resolve(false)); });
  return { socket, ok };
}
const PROTEGE_MOVES = ["ask_followup", "request_clarification", "challenge", "acknowledge", "teach_back_prompt", "confused_student"];

export const agentTurns = {
  name: "teaching.agent_turns", area: "teaching", risk: "write", timeoutMs: 600_000,
  description: "Phase 6: each teaching turn is agent-driven (adaptive-teaching-agent-v1) — the agent picks the protégé's move, the evidence and gate steps still run; switching to guide mode makes NaNa the one who replies (streamed), never the protégé; ending works.",
  params: { learner: { default: "@tester21" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const rows = [];
    ctx.cleanup(async () => { for (const id of rows) await ctx.db.deleteOwned("edu.adaptive_sessions", { ownerColumn: "student_id", ownerId: me.id, filters: { id } }); });
    const a = await connect(me);
    ctx.expect.ok("the socket connects", a.ok);
    if (!a.ok) return;
    try {
      const saved = once(a.socket, "session_saved", 120_000);
      a.socket.emit("start_adaptive_session", { topic: `${ctx.marker} Photosynthesis`, subject: "Basic Science", mode: "fresh" });
      const ready = await once(a.socket, "session_ready", 150_000);
      ctx.expect.ok("the session starts", !!ready.data?.sessionId, ready.error || ready);
      const row = (await saved).data?.rowId;
      if (row) rows.push(row);
      const steps = [];
      a.socket.on("teaching_workflow_step", (s) => steps.push(s));

      // Two teach-mode turns: the agent's choice rides on each.
      const turns = [];
      for (const message of ["Plants make their own food from sunlight, water and carbon dioxide.", "The leaf takes in carbon dioxide through tiny holes called stomata, and the roots take up water."]) {
        a.socket.emit("teacher_message", { message });
        const t = await once(a.socket, "turn_complete", 150_000);
        turns.push(t.data || {});
        ctx.expect.ok(`turn ${turns.length} completes`, !!t.data, t.error || "timeout");
      }
      const wf = turns.map((t) => t.workflow || {});
      ctx.note(`teach turns: ${JSON.stringify(wf.map((w) => ({ reply: w.reply, fallback: w.fallback })))}`);
      ctx.expect.ok("turns run the agent-driven policy", wf.every((w) => w.policyVersion === "adaptive-teaching-agent-v1"), wf.map((w) => w.policyVersion));
      ctx.expect.ok("each reply is the protégé's, in a valid move", wf.every((w) => w.reply?.tool === "protege.respond" && PROTEGE_MOVES.includes(w.reply?.move)), wf.map((w) => w.reply));
      ctx.expect.ok("the agent decided at least one turn itself (no fallback)", wf.some((w) => !w.fallback), wf.map((w) => w.fallback));
      ctx.expect.ok("the evidence and gate steps ran", wf.every((w) => (w.completedTools || []).includes("observe_teaching_evidence") && (w.completedTools || []).includes("gate_teaching_progress")), wf.map((w) => w.completedTools));
      ctx.expect.ok("each turn has the protégé's reply block", turns.every((t) => (t.blocks || []).some((b) => b.type === "student-agent" && b.text)));
      ctx.expect.ok("step labels came from the tools that ran", steps.some((s) => s.step === "protege.respond"), steps.slice(-6).map((s) => s.step));

      // Guide mode: NaNa teaches; the protégé is never called.
      a.socket.emit("set_teaching_mode", { mode: "learn_with_guide" });
      const ack = await once(a.socket, "teaching_mode", 30_000);
      ctx.expect.eq("the mode switches", ack.data?.mode, "learn_with_guide");
      let streamed = "";
      a.socket.on("guide_reply_token", (d) => { streamed += d?.token || ""; });
      a.socket.emit("teacher_message", { message: "I'm not sure what chlorophyll does. Can you help?", mode: "learn_with_guide" });
      const g = await once(a.socket, "turn_complete", 150_000);
      const gb = (g.data?.blocks || []).find((b) => b.type === "guide");
      ctx.note(`guide turn: ${JSON.stringify(g.data?.workflow?.reply)} · ${String(gb?.text || "").slice(0, 160)}`);
      ctx.expect.eq("the turn is in guide mode", g.data?.teachingMode, "learn_with_guide");
      ctx.expect.eq("NaNa replies (guide.teach)", g.data?.workflow?.reply?.tool, "guide.teach");
      ctx.expect.ok("…with a guide block, no protégé block", !!gb?.text && !(g.data?.blocks || []).some((b) => b.type === "student-agent"), (g.data?.blocks || []).map((b) => b.type));
      ctx.expect.ok("…streamed as she wrote it", streamed.length > 20, streamed.length);
      ctx.expect.ok("the gate still ran", (g.data?.workflow?.completedTools || []).includes("gate_teaching_progress"));

      a.socket.emit("end_session", {});
      const ended = await once(a.socket, "session_ended", 120_000);
      ctx.expect.eq("the learner ends it", ended.data?.endedBy, "learner");
    } finally { a.socket.close(); }
  },
};

export const teachingOutcomes = {
  name: "studyprep.teaching_outcomes", area: "study-prep", risk: "write", timeoutMs: 600_000,
  description: "Phase 7: a handed-over session ended before any teaching is abandoned and offered once more (no teach-back); the second one is taught over a real socket, the app closes, open_workflow finds the live session and it resumes with its history; ended with parts still missing it completes with objectiveMet false and the retest still unlocks; another learner can't open it.",
  params: { learner: { default: "@tester17" }, other: { default: "@tester18" }, subject: { default: "Basic Science" }, classLevel: { default: "JSS3" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const other = await ctx.as(p.other);
    const { getWorkflowHarness, teachingHandoff: handoffOf } = await import("../../adaptive-learning/index.js");
    const harness = getWorkflowHarness();
    const handoff = handoffOf();
    const active = await ctx.http({ as: p.learner, path: "/api/adaptive/study-prep/sessions" });
    if (active.body?.session?.id) await harness.cancelSession({ sessionId: active.body.session.id, learnerId: me.id }).catch(() => {});
    const session = await harness.createSession({ learnerId: me.id, goal: `${ctx.marker} Revise ${p.subject}`, subject: p.subject, classLevel: p.classLevel, examBoard: "BECE" });
    const [linked] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "*", limit: 1 });
    const wfId = linked?.workflow_id;
    if (!wfId) ctx.expect.blocked("the session has no workflow instance");
    const rowsMade = [];
    ctx.cleanup(async () => {
      await harness.cancelSession({ sessionId: session.id, learnerId: me.id }).catch(() => {});
      for (const id of rowsMade) await ctx.db.deleteOwned("edu.adaptive_sessions", { ownerColumn: "student_id", ownerId: me.id, filters: { id } });
      await ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { parent_workflow_id: wfId } });
      await ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: wfId } });
      await ctx.db.deleteOwned("edu.study_prep_sessions", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: session.id } });
    });
    const syllabus = await harness.resolveSyllabus({ sessionId: session.id, learnerId: me.id });
    if (!syllabus.found || !syllabus.topics.length) ctx.expect.blocked(`no ${p.classLevel} ${p.subject} syllabus to plan from`);
    await harness.proposePlan({ sessionId: session.id, learnerId: me.id, topicIds: [syllabus.topics[0].id] });
    await harness.confirmPlan({ sessionId: session.id, learnerId: me.id });
    const view = await harness.getSessionView({ sessionId: session.id, learnerId: me.id, eventLimit: 1 });
    const topic = view.topics.find((t) => t.status === "active");
    if (!topic) ctx.expect.blocked("no active topic after confirming");
    const [row] = await ctx.db.rows("edu.study_prep_sessions", { id: session.id }, { columns: "*", limit: 1 });
    const gaps = ["Why water moves into a cell", "What plasmolysis is"];

    // 1. Ended before any teaching → abandoned, offered once more, no teach-back.
    const first = await handoff.propose({ session: row, topic, outcome: "retest_offered", gaps });
    const a1 = await handoff.approve({ workflowId: first.workflowId, learnerId: me.id });
    if (a1?.adaptiveSessionId) rowsMade.push(a1.adaptiveSessionId);
    await handoff.bind({ workflowId: first.workflowId, learnerId: me.id, liveSessionId: `fresh_${me.id}_${Date.now()}` });
    const gone = await handoff.finish({ workflowId: first.workflowId, endResult: { totalTurns: 0 }, endedBy: "learner" });
    ctx.expect.eq("an empty end is abandoned", gone?.view?.state, "abandoned");
    let [t1] = await ctx.db.rows("edu.study_prep_topics", { id: topic.id }, { columns: "learner_confirmed_ready", limit: 1 });
    ctx.expect.ok("…with no teach-back", t1?.learner_confirmed_ready !== true, t1);
    const evs = async () => ctx.db.rows("edu.workflow_events", { workflow_id: wfId }, { columns: "event_type, payload", limit: 400, order: { column: "sequence", ascending: true } });
    const offers = (await evs()).filter((e) => e.event_type === "learner.action_required" && e.payload?.kind === "teaching_handoff");
    const second = offers.at(-1)?.payload?.teachingWorkflowId;
    ctx.expect.ok("…and it is offered once more on the card", !!second && second !== first.workflowId, offers.map((e) => e.payload?.teachingWorkflowId));
    if (!second) return;

    // 2. The second one, taught over the real socket; the app closes; open_workflow resumes it.
    const a2 = await handoff.approve({ workflowId: second, learnerId: me.id });
    if (a2?.adaptiveSessionId) rowsMade.push(a2.adaptiveSessionId);
    const A = await connect(me);
    ctx.expect.ok("the socket connects", A.ok);
    if (!A.ok) return;
    let liveId = null;
    try {
      A.socket.emit("start_adaptive_session", { topic: topic.label, subject: p.subject, mode: a2?.adaptiveSessionId ? "continuation" : "fresh", sessionId: a2?.adaptiveSessionId, workflowId: second });
      const ready = await once(A.socket, "session_ready", 150_000);
      liveId = ready.data?.sessionId || null;
      ctx.expect.ok("the handed-over session opens live", !!liveId, ready.error || ready);
      A.socket.emit("teacher_message", { message: "Water moves into a cell by osmosis, from where there is more water to where there is less, through the membrane." });
      const turn = await once(A.socket, "turn_complete", 150_000);
      ctx.expect.ok("a turn is taught", !!turn.data, turn.error || "timeout");
    } finally { A.socket.close(); }   // the learner closes the app

    const B = await connect(me);
    try {
      B.socket.emit("open_workflow", { workflowId: second });
      const opened = await once(B.socket, "workflow_opened", 30_000);
      ctx.expect.eq("open_workflow finds the live session", opened.data?.liveSessionId, liveId);
      ctx.expect.eq("…and says to resume it", opened.data?.resumeWith, "resume_session");
      B.socket.emit("resume_session", { sessionId: liveId });
      const resumed = await once(B.socket, "session_resumed", 30_000);
      ctx.expect.ok("it resumes with its history", (resumed.data?.historyBlocks || []).some((b) => b.type === "user"), resumed.error || (resumed.data?.historyBlocks || []).map((b) => b.type));
      // Ended now, with parts still missing → completed, objective not met.
      B.socket.emit("end_session", {});
      const ended = await once(B.socket, "session_ended", 150_000);
      ctx.expect.ok("it ends", !!ended.data, ended.error || "timeout");
    } finally { B.socket.close(); }
    const [done] = await ctx.db.rows("edu.workflow_instances", { id: second }, { columns: "state, metadata", limit: 1 });
    ctx.note(`outcome: ${JSON.stringify(done?.metadata?.outcome || null).slice(0, 300)}`);
    ctx.expect.eq("taught but not every part: completed", done?.state, "completed");
    ctx.expect.eq("…with objectiveMet false", done?.metadata?.outcome?.objectiveMet, false);
    [t1] = await ctx.db.rows("edu.study_prep_topics", { id: topic.id }, { columns: "learner_confirmed_ready", limit: 1 });
    ctx.expect.eq("the retest still unlocks", t1?.learner_confirmed_ready, true);

    // 3. Someone else can't open it.
    const C = await connect(other);
    try {
      C.socket.emit("open_workflow", { workflowId: second });
      const refused = await once(C.socket, "workflow_open_failed", 30_000);
      ctx.expect.ok("another learner can't open it", !!refused.data, refused);
    } finally { C.socket.close(); }
    await harness.cancelSession({ sessionId: session.id, learnerId: me.id }).catch(() => {});
  },
};
