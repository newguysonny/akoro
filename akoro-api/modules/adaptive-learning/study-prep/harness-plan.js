/**
 * study-prep harness plan operations — syllabus resolution and the plan card
 * (Master Plan §4.4, §8.7). Reads the topics the session plans against,
 * validates the agent's proposed order, and moves planning →
 * awaiting_confirmation.
 */

import { HarnessRejection } from "../../agent-runtime/index.js";
import { validatePlan } from "./state-machine.js";
import { deliberate } from "./narration.js";
import { estimateSessionCost } from "./education-engine.js";
import { classifyGoal } from "./goal-type.js";
import { generateGate, isNonCurricular } from "./materials-ops.js";
import { GENERATED_OUTLINE_LABEL } from "./harness-rules.js";

export function makePlanOps({ store, syllabus, check, reject, log, ownedSession, publicSession, publicTopic, now }) {
  /**
   * The topics this session plans against — its recorded source (§8.7): a
   * generated outline, the learner's class or school syllabus, else the
   * platform syllabus.
   */
  const topicsFor = (session) => {
    const source = session.syllabus_source;
    // The learner's own materials folder (§7.17.3): its topics, most-tested first.
    if (source === "documents" && session.syllabus_ref && syllabus.materialTopics) return syllabus.materialTopics({ folderId: session.syllabus_ref, learnerId: session.learner_id });
    if (source === "generated" && session.syllabus_ref && syllabus.generatedTopics) return syllabus.generatedTopics(session.syllabus_ref);
    if ((source === "class" || source === "school") && syllabus.topicsForSource) {
      return syllabus.topicsForSource({ source, ref: session.syllabus_ref, learnerId: session.learner_id, subject: session.subject, classLevel: session.class_level, exam: session.exam_board });
    }
    return syllabus.resolveTopics({ subject: session.subject, classLevel: session.class_level, exam: session.exam_board });
  };

  /** The real syllabus for a session, most specific first (class → school → platform). */
  // A non-curricular goal (§8.8) never plans from a class or school syllabus: only Akoro's platform one counts.
  const realSyllabus = async (session) => (syllabus.resolveSyllabusChain && !isNonCurricular(session)
    ? syllabus.resolveSyllabusChain({ learnerId: session.learner_id, subject: session.subject, classLevel: session.class_level, exam: session.exam_board })
    : { source: "platform", ref: null, topics: await syllabus.resolveTopics({ subject: session.subject, classLevel: session.class_level, exam: session.exam_board }) });

  /**
   * syllabus.resolve (§8.7): the syllabus this session plans against — the
   * learner's class syllabus, else their school's, else the platform's. The
   * most specific one wins in code; the session records it as its source, so
   * the plan is checked against the same list. A drafted outline, once made,
   * stays the source. Nothing found → found: false (then syllabus.generate).
   */
  async function resolveSyllabus({ sessionId, learnerId }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const base = { subject: session.subject, classLevel: session.class_level };
    // Planned from the learner's own materials: those topics, with how often their papers test each.
    if (session.syllabus_source === "documents" && session.syllabus_ref) {
      const topics = await topicsFor(session);
      if (!topics.length) return { ...base, topics: [], found: false, source: "documents", next: "Their materials folder has no read topics yet — tell them it's still being read, or plan from the syllabus instead." };
      return {
        ...base, found: true, source: "documents",
        note: "These are the topics in the learner's own materials. Order the plan by how often their past papers test each (papers, then marks), unless a prerequisite says otherwise; say why in one line.",
        topics: topics.map((t) => ({ id: t.id, label: t.label, ...(t.papers ? { papers: t.papers, years: t.years, marks: t.marks, questions: t.questions } : {}) })),
      };
    }
    if (session.syllabus_source === "generated" && session.syllabus_ref) {
      const topics = await topicsFor(session);
      return { ...base, found: true, source: "generated", label: GENERATED_OUTLINE_LABEL, topics: topics.map((t) => ({ id: t.id, label: t.label })) };
    }
    const real = await realSyllabus(session);
    if (!real.topics.length && isNonCurricular(session)) {
      return { ...base, topics: [], found: false, goalType: "non_curricular", next: session.materials_requested_at
        ? "No syllabus on Akoro for this goal, and you already asked the learner for materials. If they uploaded files, call syllabus.from_documents; if they said to draft one, call syllabus.generate."
        : "No syllabus on Akoro for this goal (it isn't a school exam). Check materials.list: if they uploaded files, call syllabus.from_documents; otherwise ask once with learner.request_materials and wait." };
    }
    if (!real.topics.length) {
      return { ...base, topics: [], found: false, next: "No syllabus exists for this subject and class — not the learner's class or school, not on Akoro. Call syllabus.generate to draft an outline, then propose a plan from its topics." };
    }
    const changed = session.syllabus_source !== real.source || (session.syllabus_ref || null) !== (real.ref || null);
    if (changed && ["planning", "replanning"].includes(session.status)) {
      await store.updateSessionConditional(session.id, session.status, { syllabus_source: real.source, syllabus_ref: real.ref || null, updated_at: now() });
      await log(session.id, null, {
        eventType: "harness_decision", origin: "harness", decisionNode: "syllabus_resolved",
        facts: { source: real.source, topicCount: real.topics.length, subject: session.subject, classLevel: session.class_level, className: real.className || null, term: real.term || null },
        narrative: deliberate("syllabus_resolved", { source: real.source, subject: session.subject, classLevel: session.class_level, className: real.className, term: real.term })?.narrative,
      });
    }
    return {
      ...base, found: true, source: real.source, ...(real.term ? { term: real.term } : {}),
      topics: real.topics.map((t) => ({
        id: t.id, label: t.label,
        // The class syllabus says what was taught: covered this term or still to come.
        ...(t.term ? { term: t.term } : {}), ...(t.covered != null ? { covered: t.covered } : {}),
      })),
    };
  }

  /**
   * syllabus.generate (§8.7): draft an outline ONLY when the real syllabus is
   * empty — a real syllabus always wins (`syllabus_exists`). The outline is
   * reused for the same scope; the session records it as its source.
   */
  async function generateSyllabus({ sessionId, learnerId, intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    await check("generate_syllabus", { session });
    if (!syllabus.generateOutline) return reject(session, "tool_not_permitted", "Outline drafting is not available");
    // Planned from the learner's own materials: those are the syllabus.
    if (session.syllabus_source === "documents") return reject(session, "syllabus_exists", "This plan comes from the learner's own materials — plan from syllabus.resolve");
    // A non-curricular goal asks the learner for materials (once) before an outline is drafted (§8.8).
    const gate = generateGate(session);
    if (gate) return reject(session, gate.code, gate.message);
    // Only after the class, school and platform syllabi all came back empty.
    const real = await realSyllabus(session);
    if (real.topics.length) {
      return reject(session, "syllabus_exists", "A real syllabus exists for this subject and class — plan from syllabus.resolve", { topicCount: real.topics.length, source: real.source });
    }
    let outline;
    try {
      outline = await syllabus.generateOutline({ subject: session.subject, classLevel: session.class_level, examBoard: session.exam_board, goal: session.goal, learnerId });
    } catch (error) {
      if (error?.code === "outline_invalid") return reject(session, "outline_invalid", "The drafted outline failed its checks — try again", { reason: String(error.message).slice(0, 200) });
      throw error;
    }
    const updated = await store.updateSessionConditional(session.id, session.status, {
      syllabus_source: "generated", syllabus_ref: outline.id, updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The session moved on — refresh and try again");
    await log(session.id, null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "syllabus_generated",
      agentIntent: intent, facts: { topicCount: outline.topics.length, reused: outline.reused, subject: session.subject, classLevel: session.class_level },
      narrative: deliberate("syllabus_generated", { subject: session.subject, classLevel: session.class_level, reused: outline.reused })?.narrative,
    });
    return {
      source: "generated", reused: outline.reused, label: GENERATED_OUTLINE_LABEL,
      topics: outline.topics.map((t) => ({ id: t.id, label: t.label })),
    };
  }

  // ── Session lifecycle ────────────────────────────────────────────────────

  async function createSession({ learnerId, goal, subject, classLevel = "JSS1", examBoard = "WAEC", entryMode = "syllabus", materials = null, goalType = null }) {
    const active = await store.findActiveSession(learnerId);
    if (active) throw new HarnessRejection("invalid_state_transition", "You already have an active study-prep session — finish or cancel it first", 409);
    // From a materials folder (§7.17.3): the folder is the syllabus from the start.
    const fromMaterials = materials?.folderId ? { entry_mode: "material", syllabus_source: "documents", syllabus_ref: materials.folderId } : { entry_mode: entryMode };
    // §8.8: the goal type decides the syllabus order. The column defaults to curricular, so only the other is written.
    const kind = classifyGoal(goal, { goalType });
    const session = await store.createSession({
      learner_id: learnerId, goal, subject, class_level: classLevel, ...fromMaterials,
      exam_board: examBoard, status: "planning", policy_version: "study-prep-v1",
      ...(kind === "non_curricular" ? { goal_type: kind } : {}),
    });
    await log(session.id, null, { eventType: "observation", origin: "harness", facts: { goal, subject, classLevel, entryMode: fromMaterials.entry_mode, goalType: kind, ...(materials?.folderId ? { materials: materials.name || "folder" } : {}) } });
    if (materials?.folderId) {
      await log(session.id, null, {
        eventType: "harness_decision", origin: "harness", decisionNode: "syllabus_resolved",
        facts: { source: "documents", folder: materials.name || null, subject },
        narrative: deliberate("syllabus_resolved", { source: "documents", folder: materials.name, subject })?.narrative,
      });
    }
    return publicSession(session);
  }

  /** The plan-card estimate snapshot charged at proposal time (rounded loop cost included). */
  function estimateFor(topicCount) {
    const estimate = estimateSessionCost({ topicCount });
    return { practiceCoins: estimate.practiceCoins, loopCoins: estimate.loopCoins, totalCoins: estimate.totalCoins };
  }

  async function proposePlan({ sessionId, learnerId, topicIds, intent = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    await check("propose_plan", { session });
    if (intent != null) {
      await log(session.id, null, {
        eventType: "agent_action", origin: "agent_stated_intent", action: "propose_plan",
        agentIntent: intent, facts: { topicCount: Array.isArray(topicIds) ? topicIds.length : 0 },
      });
    }
    const [syllabusTopics, prerequisites] = await Promise.all([
      topicsFor(session),
      syllabus.prerequisiteEdges({ subject: session.subject }),
    ]);
    const validation = validatePlan({ proposedTopics: topicIds, syllabusTopics, prerequisites });
    if (!validation.ok) return reject(session, validation.code, validation.message, { topics: topicIds });

    const byId = new Map(syllabusTopics.map((topic) => [topic.id, topic]));
    const plan = (topicIds || []).map((id, index) => ({
      syllabusTopicId: id, label: byId.get(id)?.label || id, position: index + 1,
    }));
    const estimate = estimateFor(plan.length);
    const updated = await store.updateSessionConditional(session.id, session.status, {
      plan, estimate, status: "awaiting_confirmation", updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The session moved on — refresh and try again");
    await log(session.id, null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "plan_validated",
      facts: { topicCount: plan.length, totalCoins: estimate.totalCoins },
      narrative: deliberate("plan_validated", { topicCount: plan.length })?.narrative,
    });
    return { session: publicSession(updated), plan, estimate };
  }

  async function confirmPlan({ sessionId, learnerId }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    await check("confirm_plan", { session });
    // Concurrent confirm: exactly one winner flips awaiting_confirmation.
    const updated = await store.updateSessionConditional(session.id, "awaiting_confirmation", {
      status: "topic_active", paused_reason: null, updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The plan was already confirmed");
    const topics = await store.createTopics(session.id, session.plan || []);
    await log(session.id, null, {
      eventType: "human_gate", origin: "harness", decisionNode: "plan_confirmed",
      facts: { topicCount: topics.length, coinsCharged: 0 },
      narrative: deliberate("plan_confirmed", { topicCount: topics.length })?.narrative,
    });
    return { session: publicSession(updated, topics), topics: topics.map(publicTopic) };
  }

  async function adjustPlan({ sessionId, learnerId, dropTopicIds = [], order = null }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    await check("adjust_plan", { session });
    const drop = new Set(dropTopicIds);
    let kept = (session.plan || []).filter((topic) => !drop.has(topic.syllabusTopicId));
    if (kept.length === 0) return reject(session, "tool_schema_invalid", "A plan needs at least one topic");
    // A new order (the learner moved topics): the same topics, re-checked against the prerequisites.
    const reordered = Array.isArray(order) && order.length ? order.filter((id) => kept.some((t) => t.syllabusTopicId === id)) : null;
    if (reordered) {
      if (reordered.length !== kept.length) return reject(session, "tool_schema_invalid", "The new order must list every kept topic once");
      const prerequisites = await syllabus.prerequisiteEdges({ subject: session.subject });
      const validation = validatePlan({ proposedTopics: reordered, syllabusTopics: kept.map((t) => ({ id: t.syllabusTopicId })), prerequisites });
      if (!validation.ok) return reject(session, validation.code, validation.message, { topics: reordered });
      kept = reordered.map((id) => kept.find((t) => t.syllabusTopicId === id));
    }
    const plan = kept.map((topic, index) => ({ ...topic, position: index + 1 }));
    const estimate = estimateFor(plan.length);
    const updated = await store.updateSessionConditional(session.id, "awaiting_confirmation", {
      plan, estimate, updated_at: now(),
    });
    if (!updated) return reject(session, "invalid_state_transition", "The plan changed — refresh and try again");
    await log(session.id, null, {
      eventType: "harness_decision", origin: "harness", decisionNode: "plan_adjusted",
      facts: { dropped: dropTopicIds.length, reordered: Boolean(reordered), topicCount: plan.length, totalCoins: estimate.totalCoins },
      narrative: deliberate("plan_adjusted", { dropped: dropTopicIds.length })?.narrative,
    });
    return { session: publicSession(updated), plan, estimate };
  }

  /** plan.validate dry-run — the agent sees exactly what the harness would check. */
  async function validateProposedPlan({ sessionId, learnerId, topicIds }) {
    const session = await ownedSession(sessionId, learnerId);
    if (!session) throw new HarnessRejection("session_not_found", "Study-prep session was not found", 404);
    const [syllabusTopics, prerequisites] = await Promise.all([
      topicsFor(session),
      syllabus.prerequisiteEdges({ subject: session.subject }),
    ]);
    const validation = validatePlan({ proposedTopics: topicIds, syllabusTopics, prerequisites });
    return { ...validation, estimate: validation.ok ? estimateFor(topicIds.length) : null };
  }

  return {
    resolveSyllabus, generateSyllabus, createSession, proposePlan, confirmPlan, adjustPlan, validateProposedPlan,
  };
}
