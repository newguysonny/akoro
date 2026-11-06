/**
 * practice/service.js — the proctored assessment as a `practice` workflow run
 * (Grand Plan §11, Phase 9). The gateway calls these; every call is
 * failure-tolerant — a workflow write never breaks a live exam.
 *
 *   begin     preparing → in_progress (questions ready)
 *   turn      audit event: the agent's picks and the chosen move
 *   pause     in_progress → paused (socket drop) · resume: paused → in_progress
 *   finish    in_progress → scoring → evaluated → completed, or → terminated;
 *             the outcome (§11.8) is recorded and emitted; evidence goes to the
 *             learner model only for a clean pass/fail
 *   abandon   → abandoned (ended early, or the reconnect grace ran out)
 */
import { practiceOutcome, evidenceAllowed } from "./workflow.js";
import { masteryWriteBack, toUnitScore } from "../study-prep/education-engine.js";

const quiet = (what) => (e) => { console.warn(`[practice ${what}]`, e?.message || e); return null; };

export function makePracticeRun({ engine, evidence = null }) {
  const event = (id, type, payload, actor = "system", visibility = "audit") =>
    engine.appendEvent(id, { event_type: type, category: "practice", actor, visibility, payload }).catch(quiet(type));

  async function begin({ learnerId, topic, subject = null, totalQuestions = 0, assessmentId, identityVerified = false }) {
    try {
      const made = await engine.create({
        workflowType: "practice", learnerId, entryMode: "proctored_assessment", state: "preparing",
        idempotencyKey: assessmentId ? `assessment:${assessmentId}` : undefined,
        metadata: { kind: "proctored", assessmentId, topic, subject, totalQuestions, identityVerified },
      });
      const wf = await engine.transition(made.instance.id, { from: "preparing", to: "in_progress" });
      await event(made.instance.id, "practice.started", { topic, totalQuestions, narrative: `Proctored assessment: ${topic}` }, "system", "learner");
      return (wf || made.instance).id;
    } catch (e) { return quiet("begin")(e); }
  }

  /** One turn's audit record — the agent's picks, never the rubric or the cheat signals. */
  async function turn(id, { agent, progress, probing, judgedScore }) {
    if (!id) return;
    await event(id, "practice.turn", { chosen: agent?.chosen, picks: agent?.picks || [], fallback: !!agent?.fallback, reason: agent?.reason || null, progress, answeredFollowUp: !!probing, judgedScore }, agent?.fallback ? "system" : "agent");
  }

  const pause = (id) => id && engine.transition(id, { from: "in_progress", to: "paused", reason: "socket_drop" }).catch(quiet("pause"));
  const resume = (id) => id && engine.transition(id, { from: "paused", to: "in_progress" }).catch(quiet("resume"));

  async function current(id) { try { return await engine.get(id); } catch { return null; } }

  /** Close the run with the code-computed verdict. → the outcome (or null). */
  async function finish(id, { learnerId, topic, subject, summary, terminated = false }) {
    if (!id) return null;
    const outcome = practiceOutcome({ score: summary.assessmentScore, verdict: summary.verdict, cheatProbability: summary.cheatProbability, questions: summary.records || [], topic });
    try {
      let wf = await current(id);
      if (wf?.state === "paused") wf = await resume(id) || await current(id);
      if (!wf || !["in_progress"].includes(wf.state)) return outcome;
      if (terminated || summary.verdict === "terminated") {
        await engine.transition(id, { from: "in_progress", to: "terminated", reason: "integrity", patch: { metadata: { outcome } } });
      } else {
        await engine.transition(id, { from: "in_progress", to: "scoring" });
        await engine.transition(id, { from: "scoring", to: "evaluated", patch: { metadata: { outcome } } });
        await engine.transition(id, { from: "evaluated", to: "completed" });
      }
      await event(id, "practice.evaluated", { verdict: outcome.verdict, score: outcome.score, recommendedNextAction: outcome.recommendedNextAction, narrative: `${outcome.verdict === "pass" ? "Passed" : outcome.verdict === "fail" ? "Not passed yet" : outcome.verdict === "flagged" ? "Flagged for review" : "Ended by proctoring"} — ${outcome.score}/100` }, "system", "learner");
      await engine.emitOutcome(id, outcome).catch(quiet("outcome"));
      // Evidence: only a clean, completed run counts (§11.4).
      if (evidence && evidenceAllowed(outcome.verdict)) {
        // assessment_score is 0–100; the learner model is 0–1 (scale guard).
        const score = toUnitScore(Number(outcome.score) || 0, { scale: "percent" }) ?? 0;
        await evidence({
          learnerId, sessionRef: `practice:${id}`, topicLabel: topic, subject, passed: outcome.passed, score,
          mastery: masteryWriteBack({ score, passed: outcome.passed }), source: "proctored_assessment",
        }).catch(quiet("evidence"));
      }
    } catch (e) { quiet("finish")(e); }
    return outcome;
  }

  async function abandon(id, reason = "ended") {
    if (!id) return;
    const wf = await current(id);
    if (!wf || !["in_progress", "paused", "preparing"].includes(wf.state)) return;
    await engine.transition(id, { from: wf.state, to: "abandoned", reason }).catch(quiet("abandon"));
  }

  return { begin, turn, pause, resume, finish, abandon };
}

let _run = null;
/** The real one: Supabase-backed engine, evidence through the Study Prep store. */
export async function practiceRun() {
  if (_run) return _run;
  const [{ default: db }, { createWorkflowEngine }, { makeSupabaseWorkflowStore }, { supabaseStore }] = await Promise.all([
    import("../../../db.js"), import("../../workflows/engine.js"), import("../../workflows/store.js"), import("../study-prep/store.js"),
  ]);
  _run = makePracticeRun({
    engine: createWorkflowEngine({ store: makeSupabaseWorkflowStore(db) }),
    evidence: (args) => supabaseStore.recordMasteryEvidence(args),
  });
  return _run;
}
