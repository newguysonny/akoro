/**
 * Phase 4a, the open items closed (registered through LEARNING_EVENTS):
 *   learning.strategy_recommend  recommendStrategies ranks the learner's own
 *     outcomes first, leaves out a strategy that failed on this concept, and
 *     limits.maxUsesPerTopic is enforced (checkStrategyLimit refuses).
 *   learning.gateway_struggle    the Python agent's concept-state gateway
 *     (POST /api/internal/agent-tools/v1/concept-state/observations) records
 *     through the one recorder: a misconception opens a struggle.
 *   learning.question_timings    Agent Check / proctored answers record
 *     per-question tags, time to answer and confusion pairs; the learner-model
 *     read helper summarises them.
 * Each adds its own approved concept (marked, removed afterwards).
 */
import { randomUUID } from "node:crypto";

async function gateConcept(ctx, db, name) {
  const tag = ctx.marker.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-10);
  const title = `${name} gate ${tag}`;
  const key = `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-gate-${tag}`;
  const { data: concept, error } = await db.schema("edu").from("concept_catalog").insert({
    curriculum_key: "verify-gate", subject: "Biology", topic_key: key, code: `gate.${key}`,
    title, objective: `Explain ${name.toLowerCase()}.`, source_type: "reviewed_content",
    source_ref: { gate: ctx.marker }, status: "approved",
  }).select("id").single();
  if (error) ctx.expect.blocked(`couldn't add the test concept: ${error.message}`);
  return { concept, title, key };
}

async function needTables(ctx, db, tables) {
  for (const table of tables) {
    const probe = await db.schema("edu").from(table).select("id").limit(1);
    if (probe.error) ctx.expect.blocked(`edu.${table} not there yet: ${probe.error.message}`);
  }
}

export const strategyRecommend = {
  name: "learning.strategy_recommend", area: "learning", risk: "write",
  description: "recommendStrategies puts what worked for this learner first, drops a strategy that failed on this concept, and a strategy past limits.maxUsesPerTopic is refused.",
  params: { learner: { default: "@tester33" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../db.js");
    const E = () => db.schema("edu");
    await needTables(ctx, db, ["learning_strategy_outcomes", "learning_struggles"]);
    const { concept, title } = await gateConcept(ctx, db, "Interference");
    const refs = [`study_prep:${randomUUID()}`, `teaching:${randomUUID()}`, `teaching:${randomUUID()}`];
    ctx.cleanup(async () => {
      await E().from("learning_strategy_outcomes").delete().eq("learner_id", me.id).in("session_ref", refs);
      await E().from("learning_struggles").delete().eq("learner_id", me.id).eq("concept_id", concept.id);
      await E().from("concept_catalog").delete().eq("id", concept.id);
    });
    const { recordStrategyOutcome } = await import("../../adaptive-learning/strategies/outcomes.js");
    const { recommendStrategies, checkStrategyLimit } = await import("../../adaptive-learning/strategies/recommend.js");
    const base = { learnerId: me.id, conceptId: concept.id, struggleType: "interference" };
    // interleave failed on this concept in Study Prep; contrast_pairs worked for this learner in Teaching.
    const failed = await recordStrategyOutcome({ ...base, strategyId: "interleave", outcome: "did_not_work", workflow: "study_prep", sessionRef: refs[0], turnRef: "gate1" });
    const worked = await recordStrategyOutcome({ ...base, strategyId: "contrast_pairs", outcome: "worked", workflow: "teaching", sessionRef: refs[1], turnRef: "gate2" });
    ctx.expect.ok("the two outcomes are recorded", failed.recorded && worked.recorded, { failed, worked });

    const r = await recommendStrategies({ learnerId: me.id, conceptId: concept.id, topic: title, struggleType: "interference", workflow: "study_prep" });
    ctx.note(`ranked: ${JSON.stringify(r.ranked.map((s) => [s.id, s.reasons]))} exhausted: ${JSON.stringify(r.exhausted)}`);
    ctx.expect.ok("not degraded (the outcomes table was read)", !r.degraded, r);
    ctx.expect.eq("what worked for the learner comes first", r.ranked[0]?.id, "contrast_pairs");
    ctx.expect.ok("…with its reason", (r.ranked[0]?.reasons || []).includes("worked_for_you"), r.ranked[0]);
    ctx.expect.ok("the strategy that failed on this concept is left out", r.exhausted.some((e) => e.id === "interleave" && e.reason === "failed_here") && !r.ranked.some((s) => s.id === "interleave"), r.exhausted);

    // prerequisite_review allows one use per topic.
    const before = await checkStrategyLimit({ learnerId: me.id, strategyId: "prerequisite_review", conceptId: concept.id });
    ctx.expect.eq("before any use it is allowed", before.refusal, null);
    await recordStrategyOutcome({ learnerId: me.id, conceptId: concept.id, strategyId: "prerequisite_review", outcome: "partial", workflow: "teaching", sessionRef: refs[2], turnRef: "gate3" });
    const after = await checkStrategyLimit({ learnerId: me.id, strategyId: "prerequisite_review", conceptId: concept.id });
    ctx.expect.eq("after its one use on this topic it is refused", after.refusal, "strategy_limit_reached");
  },
};

export const gatewayStruggle = {
  name: "learning.gateway_struggle", area: "learning", risk: "write",
  description: "A misconception the Python agent reports through the concept-state gateway is recorded by the one recorder (claim passed through) and opens a struggle.",
  params: { learner: { default: "@tester34" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    // With the gateway secrets set, the real signed request; without them, the gateway's own
    // recording path in-process (the secrets are never defaulted — the route stays closed).
    const viaHttp = !!(process.env.AKORO_AGENT_TOOLS_SECRET && process.env.AKORO_AGENT_TOOLS_CAPABILITY_SECRET);
    const { default: db } = await import("../../../db.js");
    const E = () => db.schema("edu");
    await needTables(ctx, db, ["learning_struggles"]);
    const { concept, key } = await gateConcept(ctx, db, "Evaporation");
    ctx.cleanup(async () => {
      await E().from("learning_struggles").delete().eq("learner_id", me.id).eq("concept_id", concept.id);
      await E().from("concept_catalog").delete().eq("id", concept.id);   // cascades its evidence + state
    });
    const sessionId = `gate-${randomUUID()}`;
    const observations = [{ conceptId: concept.id, kind: "misconception_detected", claimStatus: "contradicted", responseQuality: 0.2, claimValidity: 0.3, modelConfidence: 0.85, evidenceSummary: "Thinks evaporation only happens at boiling point." }];
    let states;
    if (viaHttp) {
      const { issueAgentToolsCapability } = await import("../../agent-tools/capability.js");
      const toolContext = issueAgentToolsCapability({ user: { id: me.id, role: "student" }, sessionId, learningScope: { curriculumKey: "verify-gate", subject: "Biology", topicKey: key } });
      const res = await ctx.http({
        method: "POST", path: "/api/internal/agent-tools/v1/concept-state/observations",
        headers: { "X-Akoro-Tools-Secret": process.env.AKORO_AGENT_TOOLS_SECRET },
        body: { sessionId, toolContext, turnId: "turn-1", observations },
      });
      ctx.note(`gateway (http): ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
      ctx.expect.eq("the gateway accepts the observation", res.status, 200);
      states = res.body?.states;
    } else {
      ctx.note("gateway secrets not set here: checking the gateway's recording path in-process (the HTTP route stays closed without them)");
      const { recordGatewayObservations } = await import("../../agent-tools/concept-state-routes.js");
      const { conceptObservationsRequest } = await import("../../agent-tools/concept-state-validation.js");
      states = await recordGatewayObservations(me.id, conceptObservationsRequest({ sessionId, toolContext: "in-process", turnId: "turn-1", observations }));
    }
    ctx.expect.ok("…and returns the learner's state with the misconception on", states?.[0]?.misconceptionActive === true, states);
    const [ev] = await ctx.db.rows("edu.learner_concept_evidence", { learner_id: me.id, concept_id: concept.id }, { columns: "observation_kind, claim_status, claim_validity, model_confidence, provenance" });
    ctx.expect.ok("the evidence carries the guardian's claim as given, through the recorder", ev?.claim_status === "contradicted" && Number(ev.claim_validity) === 0.3 && Number(ev.model_confidence) === 0.85 && ev.provenance?.source === "python_agent", ev);
    const [s] = await ctx.db.rows("edu.learning_struggles", { learner_id: me.id, concept_id: concept.id }, { columns: "struggle_type, status, detected_by, source_workflow" });
    ctx.expect.ok("a misconception struggle is open", s?.struggle_type === "misconception" && s.status === "open", s);
  },
};

export const questionTimings = {
  name: "learning.question_timings", area: "learning", risk: "write",
  description: "Agent Check and proctored answers record per-question tags, time to answer and confusion pairs once; the learner-model read summarises them.",
  params: { learner: { default: "@tester35" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../db.js");
    const E = () => db.schema("edu");
    await needTables(ctx, db, ["learning_question_signals"]);
    const { concept, title } = await gateConcept(ctx, db, "Transpiration");
    const refs = [`check:${randomUUID()}`, `practice:${randomUUID()}`];
    ctx.cleanup(async () => {
      await E().from("learning_question_signals").delete().eq("learner_id", me.id).in("session_ref", refs);
      await E().from("concept_catalog").delete().eq("id", concept.id);
    });
    const { recordQuestionSignals, checkQuestionSignals, proctoredQuestionSignals } = await import("../../../lib/questionSignals.js");
    const { readQuestionSignals } = await import("../../adaptive-learning/learner/learner-model.js");
    const check = checkQuestionSignals({
      battle: { topic: title },
      questions: [
        { id: "q1", question_text: "Which process loses water through the leaves?", options_json: JSON.stringify(["A. Evaporation", "B. Transpiration"]), correct_answer_index: 1, time_limit_seconds: 15 },
        { id: "q2", question_text: "Calculate the water lost: 12 - 4 ml", options_json: JSON.stringify(["A. 8 ml", "B. 6 ml"]), correct_answer_index: 0, time_limit_seconds: 20 },
      ],
      answers: [
        { question_id: "q1", selected_index: 0, is_correct: false, answer_basis: "notes", response_time_ms: 4200 },
        { question_id: "q2", selected_index: 0, is_correct: true, answer_basis: "notes", response_time_ms: 6100 },
      ],
    });
    const a = await recordQuestionSignals({ learnerId: me.id, source: "agent_check", sessionRef: refs[0], conceptId: concept.id, subject: "Biology", topic: title, questions: check });
    const again = await recordQuestionSignals({ learnerId: me.id, source: "agent_check", sessionRef: refs[0], conceptId: concept.id, subject: "Biology", topic: title, questions: check });
    const b = await recordQuestionSignals({ learnerId: me.id, source: "proctored", sessionRef: refs[1], conceptId: concept.id, subject: "Biology", topic: title, questions: proctoredQuestionSignals([{ qIndex: 0, objective: "Explain transpiration", judged: 70, answerMs: 30000 }]) });
    ctx.expect.ok("both sources record", a.recorded === 2 && b.recorded === 1, { a, again, b });
    const rows = await ctx.db.rows("edu.learning_question_signals", { learner_id: me.id, concept_id: concept.id }, { columns: "source, question_ref, skill, format, time_budget_s, time_to_answer_ms, outcome, confused_with, confusion_concept" });
    ctx.note(`rows: ${JSON.stringify(rows)}`);
    ctx.expect.eq("one row per question (a replay adds nothing)", rows.length, 3);
    const q1 = rows.find((r) => r.question_ref === "q1");
    ctx.expect.ok("tags and timing stored", q1?.format === "mcq" && q1.time_budget_s === 15 && q1.time_to_answer_ms === 4200, q1);
    ctx.expect.eq("a calculation is tagged as one", rows.find((r) => r.question_ref === "q2")?.format, "calculation");
    ctx.expect.ok("the wrong option chosen is a confusion pair", q1?.confused_with === "Evaporation" && q1.confusion_concept === title, q1);
    const read = await readQuestionSignals({ learnerId: me.id, conceptId: concept.id });
    ctx.expect.ok("the learner-model read summarises them", read.questions === 3 && read.confusions[0]?.confusedWith === "Evaporation", read);
  },
};

export const LEARNING_SIGNALS = [strategyRecommend, gatewayStruggle, questionTimings];
