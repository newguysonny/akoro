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

    const { recordTeachingEvidence } = await import("../../adaptive-learning/teaching-workflow/tools.js");
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

    const { recordTeachingEvidence } = await import("../../adaptive-learning/teaching-workflow/tools.js");
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

export const LEARNING_EVENTS = [recorderMisconception, struggleBreakthrough];
