/**
 * Phases 6–7 follow-ups on a live server (slow: real model turns).
 *   teaching.run_to_mastery     a direct teaching workflow driven turn by turn over
 *                                the real socket and the real agent-driven controller,
 *                                with scripted learner explanations, until the gate
 *                                reaches MASTERY; the workflow completes, objective met
 *   studyprep.teaching_chain    Scenario B's chain: a Study Prep topic missed → the
 *                                teaching hand-off → taught to mastery → Study Prep
 *                                hears the outcome → the retest unlocks → the agent wakes
 * The parts are the workflow's focus (the socket makes them the session's parts),
 * so the scripted explanations always match what is being taught.
 */
import { io } from "socket.io-client";
import { signInternalAccess } from "../../auth/routes.js";

const API_BASE = process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;

/** The two parts every run teaches, and what a good learner says about each (core → example → reasoning). */
export const MASTERY_PARTS = [
  {
    part: "Why water moves into a cell by osmosis",
    say: [
      "Osmosis is the movement of water molecules across a partially permeable membrane, from where there is more water (a dilute solution) to where there is less water (a concentrated solution). The membrane lets water through but not big solute molecules like sugar or salt.",
      "Here is an example: put a raisin in plain water and it swells. The water outside is more dilute than the inside of the raisin, so water moves in by osmosis. Root hair cells take up water from the soil the same way, because soil water is more dilute than the cell sap.",
      "The reason is the difference in water concentration: water keeps moving down its concentration gradient until both sides are equal. A common mistake is to say the sugar moves out — it doesn't; only the water crosses the membrane, which is why the raisin swells instead of the water turning sweet.",
    ],
  },
  {
    part: "What plasmolysis is and why it happens in salty water",
    say: [
      "Plasmolysis is when a plant cell loses so much water by osmosis that its cytoplasm and cell membrane shrink and pull away from the cell wall. It happens when the cell sits in a solution more concentrated than its cell sap, like strong salt water.",
      "Example: lettuce left in salty dressing goes limp. Water leaves the leaf cells by osmosis into the salty solution, the vacuoles shrink, the cells lose turgor and become plasmolysed, so the leaf flops.",
      "Why: the salt water outside has less water than the cell sap, so water moves out. The cell wall is rigid, so it keeps its shape while the membrane pulls away from it. Put the cell back in pure water and water moves in again, so it becomes turgid — plasmolysis is reversible if the cell is still alive.",
    ],
  },
];

const once = (socket, event, ms) => new Promise((resolve) => {
  const t = setTimeout(() => { socket.off(event, on); resolve({ timeout: true }); }, ms);
  const on = (d) => { clearTimeout(t); resolve({ data: d }); };
  socket.once(event, on);
});
async function connect(user) {
  const token = signInternalAccess({ id: user.id, role: user.role || "student" }, 1800);
  const socket = io(API_BASE, { transports: ["websocket"], auth: { token }, reconnection: false, timeout: 15_000 });
  const ok = await new Promise((resolve) => { socket.once("connect", () => resolve(true)); socket.once("connect_error", () => resolve(false)); });
  return { socket, ok };
}
const partIndex = (label) => {
  const l = String(label || "").toLowerCase();
  const i = MASTERY_PARTS.findIndex((p) => l && (p.part.toLowerCase() === l || l.includes(p.part.toLowerCase().slice(0, 24)) || p.part.toLowerCase().includes(l.slice(0, 24))));
  return i < 0 ? null : i;
};

/**
 * Teach a session to mastery over the real socket. → { opened, reached, endedBy, turns, rowId, phases, error }
 * open: the start_adaptive_session payload (topic, subject, mode, sessionId?, workflowId).
 */
export async function teachToMastery(ctx, user, open, { maxTurns = 14 } = {}) {
  const A = await connect(user);
  const out = { opened: false, reached: false, endedBy: null, turns: 0, rowId: null, phases: [], error: null };
  if (!A.ok) { out.error = "socket did not connect"; return out; }
  const s = A.socket;
  let ended = null;
  s.on("session_ended", (d) => { ended = d || {}; });
  s.on("session_saved", (d) => { if (d?.rowId) out.rowId = d.rowId; });
  try {
    s.emit("start_adaptive_session", open);
    const ready = await once(s, "session_ready", 150_000);
    out.opened = !!ready.data?.sessionId;
    if (!out.opened) { out.error = "the session did not open"; return out; }
    let current = ready.data?.currentSubtopic || ready.data?.mustKnowParts?.[0] || MASTERY_PARTS[0].part;
    const said = MASTERY_PARTS.map(() => 0);
    while (out.turns < maxTurns && !ended && !out.reached) {
      // The part being taught (by its label); unknown → the first part not yet fully explained.
      const fresh = said.findIndex((n, k) => n < MASTERY_PARTS[k].say.length);
      const i = partIndex(current) ?? (fresh < 0 ? MASTERY_PARTS.length - 1 : fresh);
      const lines = MASTERY_PARTS[i].say;
      const message = lines[said[i] % lines.length] + (said[i] >= lines.length ? ` ${lines[(said[i] + 1) % lines.length]}` : "");
      said[i] += 1;
      s.emit("teacher_message", { message });
      const t = await once(s, "turn_complete", 150_000);
      if (!t.data) { out.error = `turn ${out.turns + 1} timed out`; break; }
      out.turns += 1;
      out.phases.push(t.data.currentPhase);
      current = t.data.currentSubtopic || current;
      if (t.data.currentPhase === "MASTERY") out.reached = true;
    }
    if (out.reached && !ended) {
      // Every part verified: invite the agent to finish; if it doesn't, the learner ends it.
      s.emit("teacher_message", { message: "I think you understand every part now — let's finish the session." });
      await once(s, "turn_complete", 150_000);
      await new Promise((r) => setTimeout(r, 3000));
      if (!ended) { s.emit("end_session", {}); await once(s, "session_ended", 150_000).then((e) => { ended ||= e.data || null; }); }
    } else if (!ended) {
      s.emit("end_session", {});
      await once(s, "session_ended", 150_000).then((e) => { ended ||= e.data || null; });
    }
    out.endedBy = ended?.endedBy || null;
  } finally { s.close(); }
  return out;
}

export const runToMastery = {
  name: "teaching.run_to_mastery", area: "teaching", risk: "write", timeoutMs: 1_500_000,
  description: "Phase 6 open item: a direct teaching workflow (two parts) taught turn by turn through the real agent-driven controller with scripted learner explanations — the gate reaches MASTERY, the session ends, the workflow completes with objectiveMet true, every turn audited.",
  params: { learner: { default: "@tester44" }, maxTurns: { default: 14 } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const topic = `${ctx.marker} Osmosis`;
    const created = await ctx.http({ as: p.learner, method: "POST", path: "/api/teaching/workflows", body: { topic, subject: "Biology", mode: "teach_agent", focus: MASTERY_PARTS.map((x) => x.part) } });
    const wfId = created.body?.workflowId;
    if (!wfId) ctx.expect.blocked(`couldn't make a teaching workflow: ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    const rows = [];
    ctx.cleanup(async () => {
      for (const id of rows) await ctx.db.deleteOwned("edu.adaptive_sessions", { ownerColumn: "student_id", ownerId: me.id, filters: { id } });
      await ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: wfId } });
    });
    const run = await teachToMastery(ctx, me, { topic, subject: "Biology", mode: "fresh", workflowId: wfId }, { maxTurns: Number(p.maxTurns) || 14 });
    if (run.rowId) rows.push(run.rowId);
    ctx.note(`turns ${run.turns} · phases ${run.phases.join(" → ")} · ended by ${run.endedBy} ${run.error ? `· ${run.error}` : ""}`);
    ctx.expect.ok("the workflow's session opens live", run.opened, run.error);
    ctx.expect.ok(`the gate reaches MASTERY within ${p.maxTurns || 14} turns`, run.reached, run.phases);
    ctx.expect.ok("the session ends", !!run.endedBy, run.endedBy);
    const done = await ctx.until(async () => {
      const [w] = await ctx.db.rows("edu.workflow_instances", { id: wfId }, { columns: "state, metadata", limit: 1 });
      return w?.state === "completed" ? w : null;
    }, { timeoutMs: 30_000, everyMs: 2000 });
    ctx.note(`outcome: ${JSON.stringify(done?.metadata?.outcome || null).slice(0, 300)}`);
    ctx.expect.eq("the teaching workflow completes", done?.state, "completed");
    ctx.expect.eq("…with its objective met", done?.metadata?.outcome?.objectiveMet, true);
    const audited = await ctx.until(async () => {
      const evs = await ctx.db.rows("edu.workflow_events", { workflow_id: wfId }, { columns: "event_type", limit: 500 });
      const n = evs.filter((e) => e.event_type === "decision.made" || e.event_type === "decision.fallback").length;
      return n >= run.turns ? n : null;
    }, { timeoutMs: 20_000, everyMs: 2000 });
    ctx.expect.ok("every turn's agent decision is on the audit trail", (audited || 0) >= run.turns, audited);
  },
};

export const teachingChain = {
  name: "studyprep.teaching_chain", area: "study-prep", risk: "write", timeoutMs: 1_500_000,
  description: "Scenario B chain: a Study Prep topic the check missed → the teaching hand-off (proposed → approved) → the handed-over session taught to MASTERY over the real socket → completed with objectiveMet → Study Prep hears it (handoff_completed) → the retest unlocks (teach-back confirmed, or the topic's retest_ready / retest_offered state) → the agent wakes on teaching_done.",
  params: { learner: { default: "@tester45" }, subject: { default: "Basic Science" }, classLevel: { default: "JSS3" }, maxTurns: { default: 14 } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { getWorkflowHarness, teachingHandoff: handoffOf } = await import("../../adaptive-learning/study-prep/wiring.js");
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

    // 1. The check missed: the hand-off is proposed on its gaps (the check's outcome name, old or new).
    const gaps = MASTERY_PARTS.map((x) => x.part);
    let offer = null;
    for (const outcome of ["retest_offered", "retest_ready", "intervention_required"]) {
      offer = await handoff.propose({ session: row, topic, outcome, gaps });
      if (offer?.workflowId) break;
    }
    if (!offer?.workflowId) ctx.expect.blocked("the hand-off couldn't be proposed for a missed check");
    const childId = offer.workflowId;
    const approved = await handoff.approve({ workflowId: childId, learnerId: me.id });
    if (approved?.adaptiveSessionId) rowsMade.push(approved.adaptiveSessionId);
    ctx.expect.eq("the teaching session is approved and waits on the dashboard", approved?.state, "scheduled");

    // 2. Taught to mastery over the real socket, opened from the dashboard row.
    const run = await teachToMastery(ctx, me, {
      topic: topic.label, subject: p.subject, mode: approved?.adaptiveSessionId ? "continuation" : "fresh", sessionId: approved?.adaptiveSessionId, workflowId: childId,
    }, { maxTurns: Number(p.maxTurns) || 14 });
    if (run.rowId && !rowsMade.includes(run.rowId)) rowsMade.push(run.rowId);
    ctx.note(`turns ${run.turns} · phases ${run.phases.join(" → ")} · ended by ${run.endedBy} ${run.error ? `· ${run.error}` : ""}`);
    ctx.expect.ok("the handed-over session opens live", run.opened, run.error);
    ctx.expect.ok("the gate reaches MASTERY", run.reached, run.phases);

    // 3. Teaching completes; Study Prep hears it; the retest unlocks; the agent wakes.
    const child = await ctx.until(async () => {
      const [w] = await ctx.db.rows("edu.workflow_instances", { id: childId }, { columns: "state, metadata", limit: 1 });
      return w?.state === "completed" ? w : null;
    }, { timeoutMs: 30_000, everyMs: 2000 });
    ctx.expect.eq("the teaching workflow completes", child?.state, "completed");
    ctx.expect.eq("…with its objective met", child?.metadata?.outcome?.objectiveMet, true);
    const parentEvents = () => ctx.db.rows("edu.workflow_events", { workflow_id: wfId }, { columns: "event_type, payload", limit: 500, order: { column: "sequence", ascending: true } });
    const heard = await ctx.until(async () => (await parentEvents()).find((e) => e.event_type === "workflow.handoff_completed" && e.payload?.teachingWorkflowId === childId && !e.payload?.abandoned) || null, { timeoutMs: 30_000, everyMs: 2000 });
    ctx.expect.ok("Study Prep hears the outcome (handoff_completed on its stream)", !!heard);
    const unlocked = await ctx.until(async () => {
      const [t] = await ctx.db.rows("edu.study_prep_topics", { id: topic.id }, { columns: "*", limit: 1 });
      return t && (t.learner_confirmed_ready === true || ["retest_ready", "retest_offered"].includes(t.status) || ["retest_ready", "retest_offered"].includes(t.state)) ? t : null;
    }, { timeoutMs: 30_000, everyMs: 2000 });
    ctx.note(`topic after: ${JSON.stringify(unlocked ? { status: unlocked.status, state: unlocked.state, ready: unlocked.learner_confirmed_ready } : null)}`);
    ctx.expect.ok("the retest is unlocked", !!unlocked);
    const woke = await ctx.until(async () => (await parentEvents()).find((e) => e.payload?.trigger === "teaching_done" || String(e.payload?.wakeId || "").startsWith("teaching_done")) || null, { timeoutMs: 90_000, everyMs: 3000 });
    ctx.expect.ok("the Study Prep agent wakes on teaching_done", !!woke);
    await harness.cancelSession({ sessionId: session.id, learnerId: me.id }).catch(() => {});
  },
};
