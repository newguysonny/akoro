/**
 * modules/self-study/draft-rules.js — pure rules for activity drafts:
 * the type list, the lazy-expiry windows, the plan cleaners and the
 * non-assignment history shape. No I/O.
 */

import { ACTIVITY_TYPES, invalid } from "./createAssignment.js";

/** Battles ride the same drafting flow but assign through their battle form
 *  (the one shared BattleForm), so they are valid drafts, not bench assigns. */
export const DRAFT_TYPES = Object.freeze([...ACTIVITY_TYPES, "battle", "teaching_tool"]);

/** Pending drafts older than this are lazily expired on read (no cron). */
export const DRAFT_TTL_DAYS = 7;
/** Prepare calls are LLM-backed (nana plan generation) — a soft hourly cap. */
export const PREPARE_HOURLY_CAP = 10;

const TYPE_NAMES = {
  self_study: "self study", assignment: "assignment", project: "project",
  live_course: "live course", multi_stage: "multi-stage journey", battle: "battle", teaching_tool: "teaching resource",
};
export const typeName = (t) => TYPE_NAMES[t] || t;

export const asText = (v, max) => {
  const t = String(v ?? "").trim();
  return t ? t.slice(0, max) : undefined;
};
export const asPlan = (subtopics, objectives, existing) => {
  if (!Array.isArray(subtopics)) return undefined;
  const items = subtopics.map(st => String(st ?? "").trim()).filter(Boolean).slice(0, 12);
  if (!items.length) throw invalid("The plan needs at least one entry");
  const next = {};
  for (const st of items) {
    const source = (objectives && typeof objectives === "object" && Array.isArray(objectives[st]))
      ? objectives[st]
      : (Array.isArray(existing?.[st]) ? existing[st] : []);
    next[st] = source.map(o => String(o ?? "").trim()).filter(Boolean).slice(0, 8);
  }
  return { items, objectives: next };
};

/* ── History: a draft that isn't an assignment still keeps every round ─────────
   An assignment's rounds are question VERSIONS (draftVersions.js). Self study, projects,
   live courses, journeys and battles change a plan, stages or a brief instead — each round
   is stored as a snapshot, so V1 is never lost and "go back to version 1" is one tap. */
export const HISTORY_KEYS = ["title", "instructions", "difficulty", "details", "topic", "subtopics", "objectives", "due_at", "due_hint"];
const HISTORY_MAX = 8;
const snapshotOf = (p) => structuredClone(Object.fromEntries(HISTORY_KEYS.filter((k) => k in p).map((k) => [k, p[k]])));

/** `before` → `after` as one more history entry (seeding V1 from `before` the first time). */
export function withHistory(before, after, request) {
  const list = Array.isArray(before.history) && before.history.length
    ? before.history
    : [{ n: 1, request: "First draft", at: new Date().toISOString(), snapshot: snapshotOf(before) }];
  const n = (list.at(-1)?.n || 0) + 1;
  const kept = [...list, { n, request: String(request || "Revised").slice(0, 200), at: new Date().toISOString(), snapshot: snapshotOf(after) }];
  return { ...after, history: kept.length > HISTORY_MAX ? [kept[0], ...kept.slice(-(HISTORY_MAX - 1))] : kept, history_current: n };
}
