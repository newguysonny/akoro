/**
 * Phase 4a slice 1 — one recorder for learning evidence (learning-events.js).
 *   learning.recorder_misconception   a misconception the teaching evidence
 *     observer finds, then repairs, reaches learner_concept_evidence as
 *     misconception_detected → misconception_cleared (source: teaching), and
 *     learner_concept_state.misconception_active turns on, then off.
 * The scenario adds its own approved concept (marked, removed afterwards):
 * the sandbox catalogue may be empty, and the recorder never invents one.
 */
import { randomUUID } from "node:crypto";
import { LEARNING_SIGNALS } from "./learningSignals.js";

export const recorderMisconception = {
  name: "learning.recorder_misconception", area: "learning", risk: "write",
  description: "Teaching's misconception found → repaired goes through the one recorder into the evidence ledger and flips misconception_active on and off.",
  params: { learner: { default: "@tester30" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../db.js");
    const tag = ctx.marker.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-10);
    const title = `Osmosis gate ${tag}`;
    const { data: concept, error } = await db.schema("edu").from("concept_catalog").insert({
      curriculum_key: "verify-gate", subject: "Biology", topic_key: `osmosis-gate-${tag}`, code: `gate.osmosis.${tag}`,
      title, objective: "Explain osmosis as water moving across a membrane.", source_type: "reviewed_content",
      source_ref: { gate: ctx.marker }, status: "approved",
    }).select("id").single();
    if (error) ctx.expect.blocked(`couldn't add the test concept: ${error.message}`);
    ctx.cleanup(() => db.schema("edu").from("concept_catalog").delete().eq("id", concept.id));   // cascades its evidence + state

    const { recordTeachingEvidence } = await import("../../adaptive-learning/index.js");
    const orchestrator = { sessionMeta: { studentId: me.id, topic: title, subject: "Biology" }, dbSessionId: randomUUID() };
    const turn = (attempts, present, repaired) => ({ topic: title, mustKnowIndex: 0, mustKnowParts: [], currentSubtopic: null,
      evidenceUpdate: { observation: { misconceptionPresent: present }, current: { attempts }, misconceptionRepaired: repaired } });

    const found = await recordTeachingEvidence(orchestrator, turn(1, true, false));
    ctx.note(`found: ${JSON.stringify(found)}`);
    ctx.expect.ok("a misconception found in teaching is recorded", found.some((r) => r.kind === "misconception_detected" && r.recorded && r.conceptId === concept.id), found);
    const [s1] = await ctx.db.rows("edu.learner_concept_state", { learner_id: me.id, concept_id: concept.id }, { columns: "misconception_active, evidence_count" });
    ctx.expect.eq("…and the learner model now holds it (misconception_active)", s1?.misconception_active, true);

    const fixed = await recordTeachingEvidence(orchestrator, turn(2, false, true));
    ctx.note(`fixed: ${JSON.stringify(fixed)}`);
    ctx.expect.ok("its repair is recorded", fixed.some((r) => r.kind === "misconception_cleared" && r.recorded), fixed);
    const [s2] = await ctx.db.rows("edu.learner_concept_state", { learner_id: me.id, concept_id: concept.id }, { columns: "misconception_active, evidence_count" });
    ctx.expect.eq("…and misconception_active is off again", s2?.misconception_active, false);

    const rows = await ctx.db.rows("edu.learner_concept_evidence", { learner_id: me.id, concept_id: concept.id }, { columns: "observation_kind, provenance, claim_status" });
    ctx.expect.eq("two evidence rows", rows.length, 2);
    ctx.expect.ok("…each tagged with its source", rows.every((r) => r.provenance?.source === "teaching"), rows.map((r) => r.provenance));
    const again = await recordTeachingEvidence(orchestrator, turn(1, true, false));
    const rows2 = await ctx.db.rows("edu.learner_concept_evidence", { learner_id: me.id, concept_id: concept.id }, { columns: "id" });
    ctx.expect.eq("a replayed turn adds nothing (idempotent)", rows2.length, 2);
    void again;
  },
};

/**
 * Phase 4a slice 2 — learning.struggle_breakthrough: the same misconception
 * found in teaching opens ONE struggle (rule-detected, concept-scoped); a
 * replay adds no second row; its repair resolves it — a breakthrough with
 * resolved_at and days_to_overcome.
 */
export const struggleBreakthrough = {
  name: "learning.struggle_breakthrough", area: "learning", risk: "write",
  description: "A misconception found in teaching opens one struggle; its repair turns it into a breakthrough (resolved_at, days_to_overcome).",
  params: { learner: { default: "@tester30" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../db.js");
    const tag = ctx.marker.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-10);
    const title = `Diffusion gate ${tag}`;
    const { data: concept, error } = await db.schema("edu").from("concept_catalog").insert({
      curriculum_key: "verify-gate", subject: "Biology", topic_key: `diffusion-gate-${tag}`, code: `gate.diffusion.${tag}`,
      title, objective: "Explain diffusion as movement from high to low concentration.", source_type: "reviewed_content",
      source_ref: { gate: ctx.marker }, status: "approved",
    }).select("id").single();
    if (error) ctx.expect.blocked(`couldn't add the test concept: ${error.message}`);
    // Struggles keep their row if a concept goes (SET NULL) — remove this run's first.
    ctx.cleanup(async () => {
      await db.schema("edu").from("learning_struggles").delete().eq("learner_id", me.id).eq("concept_id", concept.id);
      await db.schema("edu").from("concept_catalog").delete().eq("id", concept.id);
    });
    const probe = await db.schema("edu").from("learning_struggles").select("id").limit(1);
    if (probe.error) ctx.expect.blocked(`edu.learning_struggles not there yet (run 2026-learning-struggles.sql): ${probe.error.message}`);

    const { recordTeachingEvidence } = await import("../../adaptive-learning/index.js");
    const orchestrator = { sessionMeta: { studentId: me.id, topic: title, subject: "Biology" }, dbSessionId: randomUUID() };
    const turn = (attempts, present, repaired) => ({ topic: title, mustKnowIndex: 0, mustKnowParts: [], currentSubtopic: null,
      evidenceUpdate: { observation: { misconceptionPresent: present }, current: { attempts }, misconceptionRepaired: repaired } });
    const struggles = () => ctx.db.rows("edu.learning_struggles", { learner_id: me.id, concept_id: concept.id },
      { columns: "id, struggle_type, category, detected_by, status, resolved_at, days_to_overcome, evidence_refs, attempts_before, sensitive" });

    const found = await recordTeachingEvidence(orchestrator, turn(1, true, false));
    ctx.note(`found: ${JSON.stringify(found).slice(0, 300)}`);
    const [open] = await struggles();
    ctx.expect.ok("a misconception struggle is opened, rule-detected", open?.struggle_type === "misconception" && open.detected_by === "rule" && open.status === "open", open);
    ctx.expect.ok("…citing the teaching turn", (open?.evidence_refs || []).some((r) => r.startsWith("teaching:")), open?.evidence_refs);

    await recordTeachingEvidence({ ...orchestrator, dbSessionId: randomUUID() }, turn(1, true, false));
    const afterRepeat = await struggles();
    ctx.expect.eq("the same misconception again adds no second struggle", afterRepeat.length, 1);
    ctx.expect.ok("…but counts the attempt", (afterRepeat[0]?.attempts_before || 0) >= 1, afterRepeat[0]);

    await recordTeachingEvidence(orchestrator, turn(2, false, true));
    const [done] = await struggles();
    ctx.note(`resolved: ${JSON.stringify(done)}`);
    ctx.expect.eq("its repair resolves it (a breakthrough)", done?.status, "resolved");
    ctx.expect.ok("…with resolved_at and days_to_overcome", !!done?.resolved_at && Number.isInteger(done?.days_to_overcome), done);
  },
};

/** A marked, approved test concept (removed afterwards with what this run wrote about it). */
async function gateConcept(ctx, db, me, name) {
  const tag = ctx.marker.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-10);
  const title = `${name} gate ${tag}`;
  const key = `${name.toLowerCase().replace(/[^a-z]+/g, "-")}-gate-${tag}`;
  const { data: concept, error } = await db.schema("edu").from("concept_catalog").insert({
    curriculum_key: "verify-gate", subject: "Biology", topic_key: key, code: `gate.${key}`,
    title, objective: `Explain ${name.toLowerCase()}.`, source_type: "reviewed_content",
    source_ref: { gate: ctx.marker }, status: "approved",
  }).select("id").single();
  if (error) ctx.expect.blocked(`couldn't add the test concept: ${error.message}`);
  return { concept, title };
}

/**
 * Phase 4a slice 3 — learning.strategy_outcome: a strategy's result is
 * recorded once (versioned; a replay adds nothing; one not allowed in the
 * workflow is refused), joins the open struggle's strategies_tried, and when
 * the struggle resolves in that session it is the breakthrough's what_worked.
 */
export const strategyOutcome = {
  name: "learning.strategy_outcome", area: "learning", risk: "write",
  description: "recordStrategyOutcome stores a strategy's result once (versioned), refuses one not allowed in the workflow, and the strategy appears as what_worked when the struggle resolves.",
  params: { learner: { default: "@tester31" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../db.js");
    const E = () => db.schema("edu");
    const { concept } = await gateConcept(ctx, db, me, "Transpiration");
    const sessionRef = `teaching:${randomUUID()}`;
    ctx.cleanup(async () => {
      await E().from("learning_strategy_outcomes").delete().eq("learner_id", me.id).eq("session_ref", sessionRef);
      await E().from("learning_struggles").delete().eq("learner_id", me.id).eq("concept_id", concept.id);
      await E().from("concept_catalog").delete().eq("id", concept.id);
    });
    for (const table of ["learning_strategy_outcomes", "learning_struggles"]) {
      const probe = await E().from(table).select("id").limit(1);
      if (probe.error) ctx.expect.blocked(`edu.${table} not there yet: ${probe.error.message}`);
    }
    const { recordLearningEvent } = await import("../../adaptive-learning/index.js");
    const { recordStrategyOutcome } = await import("../../adaptive-learning/index.js");
    const base = { learnerId: me.id, conceptId: concept.id, source: "teaching", sessionRef };

    const found = await recordLearningEvent({ ...base, kind: "misconception_detected", turnRef: "t1:misconception_detected" });
    ctx.expect.ok("a misconception opens a struggle", found.recorded && (found.struggles || []).some((s) => s.status === "opened" || s.status === "updated"), found);

    const refused = await recordStrategyOutcome({ learnerId: me.id, strategyId: "retrieval_practice", outcome: "worked", workflow: "teaching", sessionRef, conceptId: concept.id });
    ctx.expect.eq("a strategy not allowed in Teaching is refused", refused.reason, "strategy_not_permitted");

    const input = { learnerId: me.id, strategyId: "contrast_pairs", outcome: "worked", workflow: "teaching", sessionRef, turnRef: "t2:outcome", conceptId: concept.id, struggleType: "misconception" };
    const first = await recordStrategyOutcome(input);
    ctx.note(`outcome: ${JSON.stringify(first)}`);
    ctx.expect.ok("the outcome is recorded", first.recorded && !first.duplicate && !!first.id, first);
    const again = await recordStrategyOutcome(input);
    ctx.expect.ok("…a replay adds nothing", again.recorded && again.duplicate, again);
    const rows = await ctx.db.rows("edu.learning_strategy_outcomes", { learner_id: me.id, session_ref: sessionRef }, { columns: "strategy_id, strategy_version, library_version, outcome, workflow" });
    ctx.expect.eq("one outcome row", rows.length, 1);
    ctx.expect.ok("…versioned (strategy v3, library v3)", rows[0]?.strategy_version === 3 && rows[0]?.library_version === 3, rows[0]);
    const [open] = await ctx.db.rows("edu.learning_struggles", { learner_id: me.id, concept_id: concept.id }, { columns: "status, strategies_tried" });
    ctx.expect.ok("the open struggle lists it as tried", open?.status === "open" && (open.strategies_tried || []).includes("contrast_pairs"), open);

    // The repair names no strategy: the one recorded as working in this session is credited.
    await recordLearningEvent({ ...base, kind: "misconception_cleared", turnRef: "t3:misconception_cleared" });
    const [done] = await ctx.db.rows("edu.learning_struggles", { learner_id: me.id, concept_id: concept.id }, { columns: "status, what_worked_strategy, what_worked, resolved_at" });
    ctx.note(`resolved: ${JSON.stringify(done)}`);
    ctx.expect.eq("the struggle resolves (a breakthrough)", done?.status, "resolved");
    ctx.expect.eq("…and what worked is the recorded strategy", done?.what_worked_strategy, "contrast_pairs");
    ctx.expect.ok("…in words too", /contrast pairs/i.test(done?.what_worked || ""), done?.what_worked);
  },
};

/**
 * Phase 4a slice 4 — learning.backfill_idempotent: a teaching session whose
 * misconception lived only in adaptive_sessions.teaching_evidence is
 * backfilled through the recorder (source "backfill"): its evidence row and
 * struggle appear once, and a second run adds nothing.
 */
export const backfillIdempotent = {
  name: "learning.backfill_idempotent", area: "learning", risk: "write",
  description: "The one-off backfill turns a teaching session's stored misconception into evidence + a struggle; running it twice adds nothing.",
  params: { learner: { default: "@tester32" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../db.js");
    const E = () => db.schema("edu");
    const { concept, title } = await gateConcept(ctx, db, me, "Capillarity");
    const at = new Date().toISOString();
    const { data: session, error } = await E().from("adaptive_sessions").insert({
      student_id: me.id, topic: title, subject: "Biology", subtopics: [], objectives: { gate: ctx.marker },
      current_subtopic_idx: 0, current_phase: "1", status: "abandoned", started_at: at, updated_at: at,
      session_history: [], objectives_covered: {}, confidence_by_subtopic: {},
      teaching_evidence: { concepts: [{ attempts: 2, unresolvedMisconception: true, masteryStatus: "developing", coreExplanation: 0.4 }] },
    }).select("id").single();
    if (error) ctx.expect.blocked(`couldn't add the marked teaching session: ${error.message}`);
    ctx.cleanup(async () => {
      await E().from("learning_struggles").delete().eq("learner_id", me.id).eq("concept_id", concept.id);
      await E().from("adaptive_sessions").delete().eq("id", session.id);
      await E().from("concept_catalog").delete().eq("id", concept.id);   // cascades the evidence + state
    });
    const probe = await E().from("learning_struggles").select("id").limit(1);
    if (probe.error) ctx.expect.blocked(`edu.learning_struggles not there yet: ${probe.error.message}`);

    const { backfillLearningEvidence } = await import("../../adaptive-learning/index.js");
    const counts = async () => ({
      evidence: await ctx.db.rows("edu.learner_concept_evidence", { learner_id: me.id, concept_id: concept.id }, { columns: "observation_kind, provenance, source_session_id" }),
      struggles: await ctx.db.rows("edu.learning_struggles", { learner_id: me.id, concept_id: concept.id }, { columns: "id, attempts_before, status" }),
    });
    // Only this session: the marked row is newer than the live-recording cutoff, so `before` is lifted.
    const first = await backfillLearningEvidence({ learnerId: me.id, sessionIds: [session.id], before: null });
    ctx.note(`first: ${JSON.stringify(first)}`);
    const a = await counts();
    ctx.expect.ok("the stored misconception becomes one evidence row, source backfill",
      a.evidence.length === 1 && a.evidence[0].observation_kind === "misconception_detected" && a.evidence[0].provenance?.source === "backfill"
        && a.evidence[0].source_session_id === `backfill:teaching:${session.id}`, a.evidence);
    ctx.expect.ok("…and opens one struggle", a.struggles.length === 1 && a.struggles[0].status === "open", a.struggles);

    const second = await backfillLearningEvidence({ learnerId: me.id, sessionIds: [session.id], before: null });
    ctx.note(`second: ${JSON.stringify(second)}`);
    const b = await counts();
    ctx.expect.eq("a second run adds no evidence row", b.evidence.length, a.evidence.length);
    ctx.expect.eq("…no struggle row", b.struggles.length, a.struggles.length);
    ctx.expect.eq("…and no extra attempt on it", b.struggles[0]?.attempts_before, a.struggles[0]?.attempts_before);
  },
};

// Phase 4a open items (strategy_recommend, gateway_struggle, question_timings) live in learningSignals.js.
export const LEARNING_EVENTS = [recorderMisconception, struggleBreakthrough, strategyOutcome, backfillIdempotent, ...LEARNING_SIGNALS];
