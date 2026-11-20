/**
 * modules/self-study/draft-plan.js — the plan generator behind POST /plan and
 * the background plan enrichment a prepare fires outside the chat turn.
 */

import { nana } from "./createAssignment.js";
import { assemblePlan } from "./plan-scaffold.js";
import { updateDraftPayload } from "./draftVersions.js";

/** The plan generator behind POST /plan — the same one the workbench uses. */
export async function generatePlan(topic, subject) {
  const { subtopics } = await nana.generateSubtopics(topic, subject);
  // Lever 4/3: ONE batched objectives call (was one per subtopic) and the fixed
  // plan shape is assembled in code. An objectives failure degrades to per-subtopic
  // placeholders instead of failing the whole plan.
  const objectivesRaw = await nana.generateObjectivesBatch(subtopics, topic, subject).catch(() => ({}));
  return assemblePlan(subtopics, objectivesRaw);
}

// Ceiling for one background enrichment. The SDK calls are individually
// bounded (45s ×1 retry), so this mostly exists so that even a pathological
// run can't leave a draft stuck in `pending` forever.
const PLAN_ENRICH_TIMEOUT_MS = 150_000;

/**
 * Fill a draft's plan in the background — never inside the chat turn.
 * Read-modify-write so a teacher editing the preview while the model runs
 * never loses their changes, and a draft that left `draft` status
 * (assigned/discarded/expired) is left untouched. Never throws: the draft
 * already exists and is previewable; a failed enrichment just leaves the
 * editable topic-only plan and logs.
 */
export async function enrichDraftPlan(draftId, topic, subject) {
  const withDeadline = Promise.race([
    generatePlan(topic, subject),
    new Promise((_, rej) => {
      const t = setTimeout(
        () => rej(new Error(`plan generation exceeded ${PLAN_ENRICH_TIMEOUT_MS / 1000}s`)),
        PLAN_ENRICH_TIMEOUT_MS,
      );
      t.unref?.(); // never hold process shutdown open for a plan
    }),
  ]);
  try {
    const { subtopics, objectives } = await withDeadline;
    // Under the draft's lock: a question version may be landing too.
    await updateDraftPayload(draftId, (p, row) => (row.status !== "draft" ? null   // assigned/discarded/expired — leave it be
      : { ...p, subtopics, objectives, plan_status: "ready" }));
  } catch (e) {
    console.error("[prepare_activity] plan generator failed:", e.message);
    try {
      await updateDraftPayload(draftId, (p, row) => (row.status !== "draft" ? null : { ...p, plan_status: "fallback" }));
    } catch (markErr) { console.error("[prepare_activity] plan fallback mark failed:", markErr.message); }
  }
}
