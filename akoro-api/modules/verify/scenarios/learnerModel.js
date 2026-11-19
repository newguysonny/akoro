/**
 * Phase 10 — learner model unification.
 *   learner_model.next_action   the next-action recommendation comes from the
 *     Adaptive Learning Engine reading the CENTRAL learner model: a
 *     misconception teaching records (through the one recorder) makes the
 *     engine recommend CLEAR_MISTAKE for that concept and makes a resumed
 *     lesson start with the misconception flagged; its repair clears both.
 *     No per-session copy is consulted.
 * The scenario adds its own approved concept (marked, removed afterwards —
 * the delete cascades its evidence + state), as learning.recorder_misconception does.
 */
import { randomUUID } from "node:crypto";

export const learnerModelNextAction = {
  name: "learner_model.next_action", area: "learning", risk: "write",
  description: "The engine's next action for a concept comes from learner_concept_state: a recorded misconception → CLEAR_MISTAKE and a resumed lesson flags it; the repair clears both.",
  params: { learner: { default: "@tester30" } },
  async run(ctx, p) {
    const me = await ctx.as(p.learner);
    const { default: db } = await import("../../../db.js");
    const tag = ctx.marker.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-10);
    const title = `Photosynthesis gate ${tag}`;
    const { data: concept, error } = await db.schema("edu").from("concept_catalog").insert({
      curriculum_key: "verify-gate", subject: "Biology", topic_key: `photosynthesis-gate-${tag}`, code: `gate.photosynthesis.${tag}`,
      title, objective: "Explain photosynthesis as light energy making glucose from carbon dioxide and water.", source_type: "reviewed_content",
      source_ref: { gate: ctx.marker }, status: "approved",
    }).select("id").single();
    if (error) ctx.expect.blocked(`couldn't add the test concept: ${error.message}`);
    // Struggles keep their row if a concept goes (SET NULL) — remove this run's first.
    ctx.cleanup(async () => {
      await db.schema("edu").from("learning_struggles").delete().eq("learner_id", me.id).eq("concept_id", concept.id);
      await db.schema("edu").from("concept_catalog").delete().eq("id", concept.id);
    });

    const { recommendForLearner, centralMisconceptionFlags } = await import("../../adaptive-learning/learner/learner-model.js");
    const { recordTeachingEvidence } = await import("../../adaptive-learning/teaching-workflow/tools.js");
    const { createTeachingEvidenceState, applyCentralMisconceptions } = await import("../../adaptive-learning/learner/teaching-evidence.js");
    const studentState = await import("../../learner-state/index.js");
    ctx.expect.ok("decideNextAction is gone from student-state (one decision path)", typeof studentState.decideNextAction === "undefined");

    const before = await recommendForLearner({ learnerId: me.id, conceptId: concept.id });
    ctx.note(`before: ${JSON.stringify(before)}`);
    ctx.expect.ok("no evidence yet → the engine says DIG_DEEPER from the learner model", before.action === "DIG_DEEPER" && before.source === "learner_model" && !before.hasState, before);

    const orchestrator = { sessionMeta: { studentId: me.id, topic: title, subject: "Biology" }, dbSessionId: randomUUID() };
    const turn = (attempts, present, repaired) => ({ topic: title, mustKnowIndex: 0, mustKnowParts: [], currentSubtopic: null,
      evidenceUpdate: { observation: { misconceptionPresent: present }, current: { attempts }, misconceptionRepaired: repaired } });

    const found = await recordTeachingEvidence(orchestrator, turn(1, true, false));
    if (!found.some((r) => r.recorded)) ctx.expect.blocked(`the recorder did not write (${JSON.stringify(found).slice(0, 200)})`);
    const during = await recommendForLearner({ learnerId: me.id, conceptId: concept.id });
    ctx.note(`with misconception: ${JSON.stringify(during)}`);
    ctx.expect.eq("a recorded misconception → CLEAR_MISTAKE", during.action, "CLEAR_MISTAKE");
    ctx.expect.ok("…because the central state says so", during.reason === "misconception_active" && during.source === "learner_model" && during.misconceptionActive, during);

    const flags = await centralMisconceptionFlags({ learnerId: me.id, subject: "Biology", topic: title, parts: [title] });
    ctx.expect.eq("a resumed lesson reads the flag from the learner model", flags, [true]);
    const resumed = applyCentralMisconceptions(createTeachingEvidenceState({ conceptCount: 1, persisted: { concepts: [{ unresolvedMisconception: false }] } }), flags);
    ctx.expect.eq("…over the stored session copy (which said none)", resumed.concepts[0].unresolvedMisconception, true);

    await recordTeachingEvidence(orchestrator, turn(2, false, true));
    const after = await recommendForLearner({ learnerId: me.id, conceptId: concept.id });
    ctx.note(`after repair: ${JSON.stringify(after)}`);
    ctx.expect.ok("its repair → no longer CLEAR_MISTAKE", after.action !== "CLEAR_MISTAKE" && !after.misconceptionActive, after);
    const flags2 = await centralMisconceptionFlags({ learnerId: me.id, subject: "Biology", topic: title, parts: [title] });
    ctx.expect.eq("…and a resumed lesson no longer flags it", flags2, [false]);
  },
};

export const LEARNER_MODEL = [learnerModelNextAction];
