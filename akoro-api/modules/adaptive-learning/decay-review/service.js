/**
 * decay-review/service.js — runs a Decay Review (§10, Phase 8). Everything
 * injectable; wiring.js supplies the engine, the Agent Check, the decay engine
 * and the recall model.
 *
 *   start          the learner tapped Review on an alert: inspect the topic,
 *                  then a short Agent Check (retention_check)
 *   onCheckEnded   the battle worker finished a check: retained → completed;
 *                  decayed → retrieval practice; a retest passed → completed,
 *                  failed → re-teaching (once more) or completed not retained
 *   hint / answer  one recall round: the hint ladder, a server-scored answer
 *   teachingDone   the re-teaching session ended → the last retest
 *
 * The learner sees each step as its own turn in the review modal; code
 * decides every outcome.
 */
import { DECAY_POLICY, OPEN_DECAY_STATES, evaluateRetention, recallOutcome, nextHintLevel, conceptOutcomes, decayOutcome, decayView } from "./workflow.js";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** A review left in "inspecting" with no check for a minute: its step was interrupted (Phase 18 item 5). */
export const STALLED_MS = 60_000;
export function isStalledInspect(wf, nowMs = Date.now()) {
  if (wf?.state !== "inspecting" || wf.metadata?.check) return false;
  const at = Date.parse(wf.updated_at || wf.created_at || "");
  return Number.isFinite(at) && nowMs - at >= STALLED_MS;
}

export function makeDecayReview({ engine, decay, checks, recall, agentOf, findByBattle, now = () => new Date().toISOString(), log = console }) {
  const quiet = (what) => (e) => { log.warn?.(`[decay-review] ${what} failed: ${e?.message || e}`); return null; };
  const event = (id, type, payload, actor = "system") => engine.appendEvent(id, { event_type: type, category: "decay", actor, visibility: "learner", payload }).catch(quiet(type));
  const meta = (wf) => wf?.metadata || {};

  async function listOpen(learnerId) {
    const rows = await engine.listForLearner(learnerId, { active: true }).catch(() => []);
    return (rows || []).filter((r) => r.workflow_type === "decay_review" && OPEN_DECAY_STATES.includes(r.state));
  }

  /** The learner's Review tap. One open review per topic: a second tap returns it. → view */
  async function start({ learnerId, subject = null, topic, notificationId = null }) {
    if (!learnerId || !clip(topic, 200)) throw Object.assign(new Error("A review needs a topic."), { status: 400 });
    const open = (await listOpen(learnerId)).find((r) => String(meta(r).topic || "").toLowerCase() === String(topic).toLowerCase());
    if (open) {
      // Stuck mid-step (a restart between "inspect" and its check, a minute ago or more): resume it.
      if (isStalledInspect(open)) return decayView(await diagnose(open).catch((e) => { quiet("resume")(e); return open; }));
      return decayView(open);
    }
    const agentId = await agentOf(learnerId);
    if (!agentId) throw Object.assign(new Error("Create your agent first — the review checks what your agent still remembers."), { status: 409 });
    const made = await engine.create({ workflowType: "decay_review", learnerId, entryMode: notificationId ? "decay_alert" : "decay_session", state: "created",
      metadata: { subject, topic: clip(topic, 200), notificationId, agentId } });
    let wf = made.instance;
    wf = await engine.transition(wf.id, { from: "created", to: "inspecting" });
    // inspect_decay: the topic's concepts on the forgetting curve.
    const payload = await decay.session(agentId, learnerId, subject, topic).catch(quiet("inspect")) || {};
    const owned = notificationId ? await decay.markRead(notificationId, learnerId).catch(() => false) : false;
    wf = await engine.annotate(wf.id, {
      subject: payload.subject || subject, concepts: (payload.concepts || []).map((c) => ({ concept: c.concept, confidence: c.confidence ?? null })).slice(0, 12),
      faded: (payload.fadedConcepts || []).map((c) => c.concept ?? c).slice(0, 12), confidence: payload.confidence ?? null,
      daysSinceReview: payload.daysSinceReview ?? null, notificationId: owned ? notificationId : null,
    }) || wf;
    await event(wf.id, "workflow.created", { label: "Decay review", topic: meta(wf).topic, narrative: `Reviewing ${meta(wf).topic}` }, "learner");
    return decayView(await diagnose(wf));
  }

  /**
   * generate_diagnostic: a short Agent Check — has the protégé's knowledge faded?
   * The battle is a journaled outside step (actionKey, Phase 18 item 5): a review
   * interrupted here (a deploy) resumes on the next tap and reuses a battle it already made.
   */
  async function diagnose(wf) {
    const check = await checks.start({ learnerId: wf.learner_id, subject: meta(wf).subject, topic: meta(wf).topic, mode: "retention_check", total: DECAY_POLICY.CHECK_QUESTIONS, title: `Retention check: ${meta(wf).topic}`, actionKey: `decay_review:${wf.id}:check` });
    const next = await engine.transition(wf.id, { from: "inspecting", to: "diagnostic", patch: { metadata: { ...meta(wf), check: { battleId: check.battleId, kind: "retention_check", startedAt: now() } } } });
    await event(next.id, "tool.completed", { tool: "practice.run_agent_check", headline: "A short check on what your agent remembers", resultLine: `${DECAY_POLICY.CHECK_QUESTIONS} questions`, battleId: check.battleId });
    return next;
  }

  /** A check's battle ended (the battle worker). → view | null */
  async function onCheckEnded(battleId) {
    const wf = await findByBattle(battleId).catch(() => null);
    if (!wf) return null;
    const result = await checks.results(battleId).catch(quiet("results"));
    if (!result) return null;
    const summary = { battleId, score: result.score, correct: result.correct, total: result.total, perQuestion: result.perQuestion, gaps: result.gaps || [], endedAt: now() };
    if (wf.state === "diagnostic" && meta(wf).check?.battleId === battleId) {
      let cur = await engine.transition(wf.id, { from: "diagnostic", to: "evaluating", patch: { metadata: { ...meta(wf), check: { ...meta(wf).check, ...summary } } } });
      const verdict = evaluateRetention(result);
      await event(cur.id, "decay.evaluated", { verdict, score: result.score, narrative: verdict === "retained" ? `Still remembered: ${result.correct} of ${result.total}` : `Faded: ${result.correct} of ${result.total}` });
      if (verdict === "retained") {
        cur = await engine.transition(cur.id, { from: "evaluating", to: "retained" });
        return decayView(await complete(cur, { retained: true, from: "retained" }));
      }
      cur = await engine.transition(cur.id, { from: "evaluating", to: "decayed" });
      return decayView(await beginRetrieval(cur));
    }
    if (wf.state === "retest" && meta(wf).retest?.battleId === battleId) {
      const cur = await engine.annotate(wf.id, { retest: { ...meta(wf).retest, ...summary } }) || wf;
      const passed = evaluateRetention(result) === "retained";
      await event(cur.id, "decay.retested", { passed, score: result.score, narrative: passed ? `Retest passed: ${result.correct} of ${result.total}` : `Retest: ${result.correct} of ${result.total}` });
      if (passed) return decayView(await complete(cur, { retained: true, from: "retest" }));
      if ((meta(cur).retests || 0) >= DECAY_POLICY.MAX_RETESTS) return decayView(await complete(cur, { retained: false, from: "retest" }));
      // Recall wasn't enough: it needs re-learning — the decay teaching session.
      let next = await engine.transition(cur.id, { from: "retest", to: "adapt_strategy", reason: "retest_failed" });
      next = await engine.transition(next.id, { from: "adapt_strategy", to: "intervention", patch: { metadata: { ...meta(next), strategy: "teach_back", teaching: { needed: true, mode: "teach_agent", gaps: (result.gaps || []).slice(0, 4) } } } });
      await event(next.id, "strategy.selected", { strategy: "teach_back", narrative: "Re-teach it to your agent, then one last retest" }, "agent");
      return decayView(next);
    }
    return null;
  }

  /** decayed → retrieval practice (normally first, §10.2): the first recall question. */
  async function beginRetrieval(wf) {
    const round = await recall.question({ topic: meta(wf).topic, subject: meta(wf).subject, concept: pickConcept(wf, 0), gaps: meta(wf).check?.gaps || [] }).catch(quiet("recall question"));
    const retrieval = { round: 1, done: [], current: round ? { ...round, hintLevel: 0, askedAt: now() } : null };
    const next = await engine.transition(wf.id, { from: "decayed", to: "intervention", patch: { metadata: { ...meta(wf), strategy: "retrieval_practice", retrieval } } });
    await event(next.id, "strategy.selected", { strategy: "retrieval_practice", narrative: "A few quick recall questions" }, "agent");
    if (!round) return startRetest(next, "intervention");   // no question could be made: straight to the retest
    return next;
  }
  const pickConcept = (wf, i) => {
    const faded = meta(wf).faded?.length ? meta(wf).faded : (meta(wf).concepts || []).map((c) => c.concept);
    return faded.length ? faded[i % faded.length] : meta(wf).topic;
  };

  async function own(workflowId, learnerId) {
    const wf = await engine.get(workflowId, learnerId);
    if (!wf || wf.workflow_type !== "decay_review") throw Object.assign(new Error("Review not found"), { status: 404 });
    return wf;
  }

  /** The hint ladder: none → cue → partial (enforced here). → view */
  async function hint({ workflowId, learnerId }) {
    const wf = await own(workflowId, learnerId);
    const cur = meta(wf).retrieval?.current;
    if (wf.state !== "intervention" || !cur) throw Object.assign(new Error("There's no recall question right now."), { status: 409 });
    const level = nextHintLevel(cur.hintLevel || 0);
    if (level == null) return decayView(wf);
    const next = await engine.annotate(wf.id, { retrieval: { ...meta(wf).retrieval, current: { ...cur, hintLevel: level } } });
    return decayView(next || wf);
  }

  /** One recall answer: scored on the server; the next round or the retest. → { view, result } */
  async function answer({ workflowId, learnerId, answer: text }) {
    const wf = await own(workflowId, learnerId);
    const r = meta(wf).retrieval;
    const cur = r?.current;
    if (wf.state !== "intervention" || !cur) throw Object.assign(new Error("There's no recall question right now."), { status: 409 });
    const judged = await recall.judge({ question: cur.question, key: cur.key, answer: clip(text, 1500), concept: cur.concept }).catch(quiet("judge")) || { verdict: "incorrect", feedback: "" };
    const outcome = recallOutcome({ verdict: judged.verdict, hintLevel: cur.hintLevel || 0 });
    const done = [...(r.done || []), { concept: cur.concept, question: cur.question, outcome, hintLevel: cur.hintLevel || 0, feedback: clip(judged.feedback, 400), keyShown: clip(cur.key, 300) }];
    const result = { outcome, feedback: clip(judged.feedback, 400), answer: clip(cur.key, 300) };
    if (done.length < DECAY_POLICY.RETRIEVAL_ROUNDS) {
      const q = await recall.question({ topic: meta(wf).topic, subject: meta(wf).subject, concept: pickConcept(wf, done.length), gaps: meta(wf).check?.gaps || [], avoid: done.map((d) => d.question) }).catch(quiet("recall question"));
      if (q) {
        const next = await engine.annotate(wf.id, { retrieval: { round: done.length + 1, done, current: { ...q, hintLevel: 0, askedAt: now() } } });
        return { view: decayView(next || wf), result };
      }
    }
    const moved = await engine.annotate(wf.id, { retrieval: { round: done.length, done, current: null } }) || wf;
    return { view: decayView(await startRetest(moved, "intervention")), result };
  }

  /** The retest: an Agent Check again (at most MAX_RETESTS). */
  async function startRetest(wf, from) {
    const retests = (meta(wf).retests || 0) + 1;
    const check = await checks.start({ learnerId: wf.learner_id, subject: meta(wf).subject, topic: meta(wf).topic, mode: "retest", total: DECAY_POLICY.RETEST_QUESTIONS, title: `Retest: ${meta(wf).topic}`, actionKey: `decay_review:${wf.id}:retest:${retests}` });
    const next = await engine.transition(wf.id, { from, to: "retest", patch: { metadata: { ...meta(wf), retests, retest: { battleId: check.battleId, kind: "retest", startedAt: now() } } } });
    await event(next.id, "tool.completed", { tool: "practice.run_agent_check", headline: "The retest", resultLine: `${DECAY_POLICY.RETEST_QUESTIONS} questions`, battleId: check.battleId });
    return next;
  }

  /** The re-teaching session ended (websocket end_session) → the last retest. */
  async function teachingDone({ workflowId, learnerId }) {
    const wf = await own(workflowId, learnerId);
    if (wf.state !== "intervention" || !meta(wf).teaching?.needed) return decayView(wf);
    const marked = await engine.annotate(wf.id, { teaching: { ...meta(wf).teaching, needed: false, endedAt: now() } }) || wf;
    return decayView(await startRetest(marked, "intervention"));
  }

/**
 * Decay Review → learner model, per concept (§7.8.1): recall_success when it
 * came back, recall_gap when it hadn't. The learner's own recall rounds are
 * human answers (source learner_recall, they move the state); the retention
 * check is the agent recalling from its notes (agent_recall, ledger only —
 * as for Study Prep's Agent Check).
 */
async function recordDecayEvidence({ learnerId, workflowId, subject, topic, outcomes = {}, recalls = [], strategy = null, retained = null }) {
  const { recordLearningEvent } = await import("../learning-events.js");
  const asked = new Set(recalls.map((r) => String(r.concept || "").toLowerCase()));
  const out = [];
  for (const [concept, result] of Object.entries(outcomes)) {
    const human = asked.has(String(concept).toLowerCase());
    const kind = result === "correct" ? "recall_success" : "recall_gap";
    const base = { learnerId, subject, kind, source: human ? "learner_recall" : "agent_recall", checked: human,
      sessionRef: `decay:${workflowId}`, turnRef: `${concept.slice(0, 80)}:${kind}`, workflowId,
      quality: result === "correct" ? 0.85 : result === "partial" ? 0.5 : 0.2,
      summary: `Decay review: ${concept} ${result === "correct" ? "came back" : result === "partial" ? "partly came back" : "had faded"}${human ? " (the learner recalled it)" : " (from the agent's notes)"}`,
      // What brought it back (a breakthrough's what_worked_strategy).
      details: { concept, result, ...(strategy && kind === "recall_success" ? { strategy } : {}) } };
    let r = await recordLearningEvent({ ...base, topic: concept });
    if (!r.recorded) r = await recordLearningEvent({ ...base, topic });
    out.push({ concept, kind, ...r });
  }
  // How the review's strategy turned out (Phase 4a slice 3).
  if (strategy && retained != null) {
    const { recordStrategyOutcome } = await import("../strategies/outcomes.js");
    out.push({ kind: "strategy_outcome", strategy, ...(await recordStrategyOutcome({ learnerId, strategyId: strategy, outcome: retained ? "worked" : "did_not_work",
      workflow: "decay_review", sessionRef: `decay:${workflowId}`, turnRef: "complete", subject, topic, struggleType: "decay" })) });
  }
  return out;
}

  /** Reinforce what the review reached, resolve the alert, record the outcome. */
  async function complete(wf, { retained, from }) {
    const m = meta(wf);
    const recalls = m.retrieval?.done || [];
    const last = m.retest?.score != null ? m.retest : m.check;
    const outcomes = conceptOutcomes({ concepts: m.concepts || [], check: last, recalls });
    const reinforced = await decay.reinforce(m.agentId, wf.learner_id, m.subject, m.topic, Math.round((Number(last?.score) || 0) * 100), wf.id, { conceptOutcomes: outcomes }).catch(quiet("reinforce"));
    if (m.notificationId) await decay.markActioned(m.notificationId, wf.id, wf.learner_id).catch(quiet("alert"));
    const checksDone = [m.check && { kind: "retention_check", ...m.check }, m.retest && m.retest.score != null && { kind: "retest", ...m.retest }].filter(Boolean);
    const outcome = { ...decayOutcome({ retained, before: m.confidence ?? reinforced?.confidenceBefore ?? null, after: reinforced?.confidenceAfter ?? null, strategy: m.strategy, recalls, checks: checksDone }),
      nextReviewDue: reinforced?.nextReviewDue || null, concepts: outcomes };
    const done = await engine.transition(wf.id, { from, to: "completed", patch: { metadata: { ...m, outcome, endedAt: now() } } });
    await event(done.id, "workflow.completed", { outcome, narrative: retained ? "Still remembered — reinforced" : "Not retained yet — it comes back sooner" });
    // Phase 4a (D37): each concept's recall result goes to the learner model.
    void recordDecayEvidence({ learnerId: wf.learner_id, workflowId: wf.id, subject: m.subject, topic: m.topic, outcomes, recalls, strategy: m.strategy || null, retained }).catch(quiet("evidence"));
    return done;
  }

  async function view({ workflowId, learnerId }) { return decayView(await own(workflowId, learnerId)); }
  async function abandon({ workflowId, learnerId }) {
    const wf = await own(workflowId, learnerId);
    if (!OPEN_DECAY_STATES.includes(wf.state)) return decayView(wf);
    return decayView(await engine.transition(wf.id, { from: wf.state, to: "abandoned", reason: "learner_left" }).catch(() => wf));
  }

  return { start, onCheckEnded, hint, answer, teachingDone, view, abandon, listOpen: async (learnerId) => (await listOpen(learnerId)).map(decayView) };
}
