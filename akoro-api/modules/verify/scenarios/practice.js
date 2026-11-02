/**
 * Phase 9 on a live server (Grand Plan §11, Scenario D): the proctored
 * assessment over a real WebSocket, the way AssessmentRoom runs it —
 * start_assessment → assessment_message* → assessment_summary — now as a
 * `practice` workflow run: the agent picks each next move (next question,
 * one follow-up, a hint within policy), the score and the verdict are
 * computed in code, and the run closes with its outcome. The integrity
 * variant sends sustained proctoring signals: the run is flagged whatever
 * the score, and no evidence is written.
 */
import { io } from "socket.io-client";
import { signInternalAccess } from "../../auth/routes.js";

const API_BASE = process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const once = (socket, event, ms) => new Promise((resolve) => {
  const t = setTimeout(() => { socket.off(event, on); socket.off("assessment_error", onErr); resolve({ timeout: true }); }, ms);
  const on = (d) => { clearTimeout(t); socket.off("assessment_error", onErr); resolve({ data: d }); };
  const onErr = (e) => { clearTimeout(t); socket.off(event, on); resolve({ error: e?.message || String(e) }); };
  socket.once(event, on);
  socket.once("assessment_error", onErr);
});

async function connect(user) {
  const token = signInternalAccess({ id: user.id, role: user.role || "student" }, 900);
  const socket = io(API_BASE, { transports: ["websocket"], auth: { token }, reconnection: false, timeout: 15_000 });
  const ok = await new Promise((resolve) => { socket.once("connect", () => resolve(true)); socket.once("connect_error", () => resolve(false)); });
  return { socket, ok };
}

/** Answers good enough to be judged — the exam is real; the content is generic on purpose. */
const ANSWER = "Photosynthesis happens in the chloroplasts: chlorophyll absorbs light energy, which splits water and releases oxygen; the energy (ATP and NADPH) is then used in the Calvin cycle to fix carbon dioxide into glucose. So 6CO2 + 6H2O + light → C6H12O6 + 6O2.";

async function startExam(ctx, socket, topic, questionCount = 3) {
  socket.emit("start_assessment", { topic, subject: "Biology", questionCount });
  const ready = await once(socket, "assessment_ready", 120_000);
  ctx.expect.ok("the assessment starts (Sergeant's questions are ready)", !!ready.data?.assessmentId, ready.error || (ready.timeout ? "timed out" : null));
  return ready.data || null;
}

async function cleanup(ctx, me, topic) {
  const sessions = await ctx.db.rows("edu.assessment_sessions", { student_id: me.id, topic }, { columns: "id", limit: 5 }).catch(() => []);
  for (const s of sessions) await ctx.db.deleteOwned("edu.assessment_sessions", { ownerColumn: "student_id", ownerId: me.id, filters: { id: s.id } });
  const runs = await ctx.db.rows("edu.workflow_instances", { learner_id: me.id, workflow_type: "practice" }, { columns: "id, metadata", limit: 20 }).catch(() => []);
  for (const r of runs.filter((x) => x.metadata?.topic === topic)) await ctx.db.deleteOwned("edu.workflow_instances", { ownerColumn: "learner_id", ownerId: me.id, filters: { id: r.id } });
}

export const practiceProctoredFlow = {
  name: "practice.proctored_flow", area: "practice", risk: "write", timeoutMs: 480_000,
  description: "Scenario D: a proctored assessment over WebSocket as a practice workflow — the agent picks next/probe/hint each turn (audited), the score and verdict are computed in code, the run goes in_progress → scoring → evaluated → completed with its outcome, and the session row links to the run.",
  params: { learner: { default: "@tester37" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const topic = `${ctx.marker} Photosynthesis`;
    ctx.cleanup(() => cleanup(ctx, me, topic));
    const c = await connect(me);
    ctx.expect.ok("the socket connects", c.ok);
    if (!c.ok) { c.socket.close(); return; }
    const ready = await startExam(ctx, c.socket, topic, 3);
    if (!ready) { c.socket.close(); return; }
    ctx.expect.ok("…with a first question", (ready.openingBlocks || []).some((b) => b.type === "question"));

    // Answer until the exam is done (probes and hints add turns; bounded).
    const summaryP = once(c.socket, "assessment_summary", 360_000);
    const kinds = { question: 0, followUp: 0, hint: 0 };
    let done = false;
    for (let i = 0; i < 9 && !done; i++) {
      c.socket.emit("assessment_message", { message: ANSWER });
      const turn = await once(c.socket, "assessment_turn", 120_000);
      if (!turn.data) { ctx.expect.ok(`turn ${i + 1} comes back`, false, turn.error || "timed out"); break; }
      for (const b of turn.data.blocks || []) {
        if (b.type === "question" && b.followUp) kinds.followUp++;
        else if (b.type === "question") kinds.question++;
        else if (b.type === "hint") kinds.hint++;
      }
      done = !!turn.data.done;
    }
    ctx.note(`turns: ${JSON.stringify(kinds)}`);
    ctx.expect.ok("every question is answered", done);
    ctx.expect.ok("hints stay within the policy (≤2 per exam)", kinds.hint <= 2, kinds);
    const summary = (await summaryP).data;
    ctx.expect.ok("a summary arrives", !!summary);
    c.socket.close();
    if (!summary) return;
    ctx.expect.ok("the verdict is pass or fail (clean run)", ["pass", "fail"].includes(summary.verdict), summary.verdict);
    ctx.expect.eq("…and matches the code rule (score ≥ 70 ⇒ pass)", summary.verdict, (summary.assessmentScore >= 70 ? "pass" : "fail"));
    ctx.expect.ok("the summary names its workflow run", /^[0-9a-f-]{36}$/i.test(summary.workflowId || ""), summary.workflowId);
    ctx.expect.ok("Sergeant explains the verdict", String(summary.verdictDetail || "").length > 10);
    if (!summary.workflowId) return;

    await sleep(3_000);
    const [run] = await ctx.db.rows("edu.workflow_instances", { id: summary.workflowId }, { columns: "id, state, status, metadata, learner_id", limit: 1 });
    ctx.expect.eq("the run is completed", run?.state, "completed");
    ctx.expect.eq("…its outcome carries the verdict", run?.metadata?.outcome?.verdict, summary.verdict);
    ctx.expect.eq("…and the score", run?.metadata?.outcome?.score, summary.assessmentScore);
    ctx.expect.ok("…and what's next", ["none", "teaching", "retrieval_practice"].includes(run?.metadata?.outcome?.recommendedNextAction), run?.metadata?.outcome);
    const events = await ctx.db.rows("edu.workflow_events", { workflow_id: summary.workflowId }, { columns: "event_type, payload, actor", limit: 50 });
    const turns = events.filter((e) => e.event_type === "practice.turn");
    ctx.expect.ok("every turn's decision is audited", turns.length >= 3, turns.length);
    ctx.expect.ok("…with the agent's pick (or a recorded fallback)", turns.every((t) => ["assessment_ask_next", "assessment_probe", "assessment_give_hint"].includes(t.payload?.chosen)));
    ctx.note(`agent picks: ${turns.map((t) => `${t.payload?.chosen}${t.payload?.fallback ? `(fallback:${t.payload?.reason})` : ""}`).join(", ")}`);
    ctx.expect.ok("the audit holds no integrity signals", !JSON.stringify(turns).includes("cheat"));
    ctx.expect.ok("the outcome is recorded", events.some((e) => e.event_type === "outcome"));
    const [row] = await ctx.db.rows("edu.assessment_sessions", { student_id: me.id, topic }, { columns: "id, status, final_verdict, assessment_score, workflow_id", limit: 1 });
    ctx.expect.eq("the session row is completed with the same verdict", `${row?.status}/${row?.final_verdict}`, `completed/${summary.verdict}`);
    ctx.expect.eq("…and links to the run", row?.workflow_id, summary.workflowId);
  },
};

export const practiceIntegrityFlagged = {
  name: "practice.integrity_flagged", area: "practice", risk: "write", timeoutMs: 480_000,
  description: "Scenario D integrity variant: sustained proctoring signals (two faces, looking away, background speech) push the cheat probability past 0.4 — the exam still finishes, but the verdict is flagged whatever the score; the run completes with an outcome that recommends nothing and writes no evidence. (Auto-terminate at 0.85 needs the proctor service's signals; it is covered by the contract test.)",
  params: { learner: { default: "@tester38" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const topic = `${ctx.marker} Osmosis`;
    ctx.cleanup(() => cleanup(ctx, me, topic));
    const c = await connect(me);
    ctx.expect.ok("the socket connects", c.ok);
    if (!c.ok) { c.socket.close(); return; }
    const ready = await startExam(ctx, c.socket, topic, 2);
    if (!ready) { c.socket.close(); return; }
    let peak = 0;
    c.socket.on("proctor_result", (r) => { peak = Math.max(peak, Number(r?.probability) || 0); });
    for (let i = 0; i < 40 && peak < 0.4; i++) {
      c.socket.emit("proctor_frame", { frame: null, signals: { faceCount: 2, facePresent: true, lookingAway: true, audioLevel: 0.9 } });
      await sleep(1_400);
    }
    ctx.note(`peak probability seen: ${peak}`);
    ctx.expect.ok("sustained signals raise the cheat probability past the flag line (0.4)", peak >= 0.4, peak);
    const summaryP = once(c.socket, "assessment_summary", 360_000);
    let done = false;
    for (let i = 0; i < 7 && !done; i++) {
      c.socket.emit("assessment_message", { message: "Osmosis is the net movement of water molecules across a partially permeable membrane from a region of higher water potential (dilute solution) to lower water potential (concentrated solution). Plant cells become turgid in pure water; animal cells can burst." });
      const turn = await once(c.socket, "assessment_turn", 120_000);
      if (!turn.data) break;
      done = !!turn.data.done;
    }
    const summary = (await summaryP).data;
    c.socket.close();
    ctx.expect.eq("the verdict is flagged, whatever the score", summary?.verdict, "flagged");
    ctx.note(`score ${summary?.assessmentScore}, cheat ${summary?.cheatProbability}`);
    if (!summary?.workflowId) { ctx.expect.ok("the summary names its workflow run", false); return; }
    await sleep(3_000);
    const [run] = await ctx.db.rows("edu.workflow_instances", { id: summary.workflowId }, { columns: "id, state, metadata", limit: 1 });
    ctx.expect.eq("the run completes", run?.state, "completed");
    ctx.expect.eq("…its outcome is flagged", run?.metadata?.outcome?.verdict, "flagged");
    ctx.expect.eq("…recommending nothing", run?.metadata?.outcome?.recommendedNextAction, "none");
    ctx.expect.eq("…with no evidence", (run?.metadata?.outcome?.conceptEvidence || []).length, 0);
    const evidence = await ctx.db.rows("edu.learner_concept_evidence", { learner_id: me.id, source_session_id: `practice:${summary.workflowId}` }, { columns: "concept_id", limit: 5 }).catch(() => []);
    ctx.expect.eq("no evidence reaches the learner model", evidence.length, 0);
    const [row] = await ctx.db.rows("edu.assessment_sessions", { student_id: me.id, topic }, { columns: "status, final_verdict", limit: 1 });
    ctx.expect.eq("the session row is completed and flagged", `${row?.status}/${row?.final_verdict}`, "completed/flagged");
  },
};
