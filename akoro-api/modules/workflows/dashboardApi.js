/**
 * workflows/dashboardApi.js — the dashboard's reads, owner-pinned, with the
 * engine and the row sources injected (routes.js wires the real ones; the
 * contract test passes the in-memory store).
 *
 *   forLearner(userId)       → { workflows: [descriptor], needsYou: { items, counts }, unavailable }
 *   one(userId, workflowId)  → descriptor | null   (another learner's run → null)
 *   needsYouFor(user)        → { audience, items, counts, unavailable }
 *                              (an instructor's list: drafts, proposals, cards)
 */
import { describeWorkflow } from "./dashboard.js";
import { needsYou } from "./needsYou.js";

export const INSTRUCTOR_ROLES = Object.freeze(["instructor", "teacher"]);
export const audienceOf = (user) => (INSTRUCTOR_ROLES.includes(user?.role) ? "instructor" : "learner");

export function makeDashboardApi({ engine, sources, now = () => Date.now() }) {
  async function forLearner(userId) {
    const s = await sources.learner(userId);
    // The store is already pinned to the learner; checked again so a stray row can never show.
    const runs = (s.workflows || []).filter((r) => r && r.learner_id === userId);
    const byId = new Map(runs.map((r) => [r.id, r]));
    const workflows = runs.map((r) => describeWorkflow(r, {
      parent: byId.get(r.source_workflow_id || r.parent_workflow_id) || null,
      facts: s.workflowFacts?.[r.id] || null,
    }));
    const list = needsYou({ ...s, ownerId: userId, audience: "learner", workflows: runs, now: now() });
    return { workflows, needsYou: list, unavailable: s.unavailable || [] };
  }

  async function one(userId, workflowId) {
    const r = await engine.get(workflowId, userId);
    if (!r) return null;
    const parentId = r.source_workflow_id || r.parent_workflow_id;
    const parent = parentId ? await engine.get(parentId, userId).catch(() => null) : null;
    const facts = r.workflow_type === "study_prep" && sources.studyPrepFacts
      ? (await sources.studyPrepFacts([r]).catch(() => ({})))[r.id] || null : null;
    return describeWorkflow(r, { parent, facts });
  }

  async function needsYouFor(user) {
    const audience = audienceOf(user);
    if (audience === "learner") {
      const { needsYou: list, unavailable } = await forLearner(user.id);
      return { audience, ...list, unavailable };
    }
    const s = await sources.instructor(user.id);
    return { audience, ...needsYou({ ...s, ownerId: user.id, audience, now: now() }), unavailable: s.unavailable || [] };
  }

  return { forLearner, one, needsYouFor };
}
