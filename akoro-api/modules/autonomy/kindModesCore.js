/**
 * modules/autonomy/kindModesCore.js — watch-only mode for proactive work
 * (Grand Plan Phase 18 item 1). Pure: no db.
 *
 * Every proactive proposal kind has a mode:
 *   off      the cycle drops it
 *   observe  the cycle runs the same reasoning and records "would have
 *            proposed X to learner Y because …" — never shown, never charged,
 *            never counted against caps or quiet hours
 *   live     as before: proposed, delivered, counted
 *
 * Every kind that existed when modes were introduced is live by default (so
 * nothing a learner gets changes); any other kind is observe by default — a
 * new kind has to be switched live by an admin.
 *
 * A row may carry a scope: scope_mode applies to the learners listed and to
 * everyone in the schools listed (e.g. live for one school, observe for
 * everyone else; or observe for one tester while live for everyone).
 *
 *   resolveMode(kind, row, { userId, schoolId })   → "off" | "observe" | "live"
 *   modeResolver(rows, who)                         → (kind) → mode
 *   splitByMode(items, modeOf)                      → { live, observe, off }
 *   validateModeChange(kind, body)                  → { ok, change } | { ok: false, error }
 *   observationRows(items, { userId, runId, audience })
 *   observeOnly(modeOf, kinds)                      nothing can be shown this run?
 *   laterAccepted(observations, proposals)          adds acceptedLater per observation
 */
import { LEARNER_KINDS, INSTRUCTOR_KINDS } from "./readyKinds.js";

export const MODES = Object.freeze(["off", "observe", "live"]);
/** Learner kinds the cycle can produce: the planner's, plus fix_it (code-found) and idea (the Ideas list). */
export const LEARNER_PROACTIVE_KINDS = Object.freeze([...LEARNER_KINDS, "fix_it", "idea"]);
export const INSTRUCTOR_PROACTIVE_KINDS = Object.freeze([...INSTRUCTOR_KINDS]);
/** The kinds that existed when modes arrived (2026-11-02): live unless an admin says otherwise. */
export const EXISTING_KINDS = Object.freeze(new Set([...LEARNER_PROACTIVE_KINDS, ...INSTRUCTOR_PROACTIVE_KINDS]));
/** Observations kept per cycle (they cost nothing, but a runaway planner shouldn't fill the table). */
export const MAX_OBSERVATIONS_PER_RUN = 10;

export const audienceOf = (kind) => (INSTRUCTOR_PROACTIVE_KINDS.includes(kind) ? "instructor" : "learner");

/** The mode with no row: existing kinds live, anything new observe. */
export function defaultModeFor(kind) {
  return EXISTING_KINDS.has(kind) ? "live" : "observe";
}

const inList = (list, id) => !!id && Array.isArray(list) && list.map(String).includes(String(id));

/** One kind's mode for one person. Pure. */
export function resolveMode(kind, row, { userId = null, schoolId = null } = {}) {
  if (!row) return defaultModeFor(kind);
  const base = MODES.includes(row.mode) ? row.mode : defaultModeFor(kind);
  if (row.scope_mode && MODES.includes(row.scope_mode)
    && (inList(row.scope_user_ids, userId) || inList(row.scope_school_ids, schoolId))) return row.scope_mode;
  return base;
}

/** Does any row scope by school (only then is the person's school worth a read)? */
export const needsSchool = (rows = []) => rows.some((r) => r?.scope_mode && Array.isArray(r.scope_school_ids) && r.scope_school_ids.length);

/** rows (from edu.agent_kind_modes) + who → kind → mode. Missing rows fall back to the defaults. */
export function modeResolver(rows = [], who = {}) {
  const byKind = new Map((rows || []).map((r) => [r.kind, r]));
  return (kind) => resolveMode(kind, byKind.get(kind), who);
}

/** Split shaped proposals (each with .kind) by their mode. Order kept within each group. */
export function splitByMode(items = [], modeOf, kindOf = (x) => x.kind) {
  const out = { live: [], observe: [], off: [] };
  for (const it of items || []) out[modeOf(kindOf(it)) || "live"].push(it);
  return out;
}

/** Nothing this person could be shown: every kind off or observe (and at least one observed). */
export function observeOnly(modeOf, kinds = LEARNER_PROACTIVE_KINDS) {
  const modes = kinds.map((k) => modeOf(k));
  return !modes.includes("live") && modes.includes("observe");
}

/** Every kind off for this person: nothing to reason about at all. */
export const allOff = (modeOf, kinds = LEARNER_PROACTIVE_KINDS) => kinds.every((k) => modeOf(k) === "off");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = /^[a-z][a-z0-9_]{1,40}$/;

/**
 * An admin's change, checked. body: { mode, scope?: { mode, userIds?, schoolIds? } | null, note? }
 * → { ok: true, change: { mode, scope_mode, scope_user_ids, scope_school_ids, note } } | { ok: false, error }
 */
export function validateModeChange(kind, body = {}) {
  if (!KIND.test(String(kind || ""))) return { ok: false, error: "kind is invalid" };
  const mode = String(body.mode || "");
  if (!MODES.includes(mode)) return { ok: false, error: "mode must be off, observe or live" };
  const change = { mode, scope_mode: null, scope_user_ids: [], scope_school_ids: [], note: body.note ? String(body.note).slice(0, 300) : null };
  const s = body.scope;
  if (s && (s.mode || (s.userIds || []).length || (s.schoolIds || []).length)) {
    if (!MODES.includes(String(s.mode || ""))) return { ok: false, error: "scope.mode must be off, observe or live" };
    const users = [...new Set((s.userIds || []).map(String))];
    const schools = [...new Set((s.schoolIds || []).map(String))];
    if (!users.length && !schools.length) return { ok: false, error: "a scope names at least one learner or school" };
    if (users.length > 200) return { ok: false, error: "a scope lists at most 200 learners" };
    if (schools.length > 1) return { ok: false, error: "a scope names at most one school" };
    if (![...users, ...schools].every((id) => UUID.test(id))) return { ok: false, error: "scope ids must be uuids" };
    if (s.mode === mode) return { ok: false, error: "the scope's mode is the same as the kind's — leave the scope out" };
    Object.assign(change, { scope_mode: s.mode, scope_user_ids: users, scope_school_ids: schools });
  }
  return { ok: true, change };
}

/** The rows an observe pass writes: what it would have proposed, to whom, and why. */
export function observationRows(items = [], { userId, runId = null, audience = "learner" } = {}) {
  return (items || []).slice(0, MAX_OBSERVATIONS_PER_RUN).map((p) => ({
    kind: p.kind, audience, user_id: userId, run_id: runId,
    title: String(p.title || "").slice(0, 200) || p.kind,
    reason: p.rationale ? String(p.rationale).slice(0, 400) : (p.why ? String(p.why).slice(0, 400) : null),
    preview: p.preview || (p.brief ? { brief: String(p.brief).slice(0, 300) } : null),
    payload: p.payload || (p.context ? { context: p.context } : {}),
  }));
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ACCEPTED = new Set(["approved", "executed"]);
const thingOf = (pl = {}) => pl.recordId || pl.goalId || pl.assignmentId || norm(pl.topic) || null;

/**
 * Real outcomes beside the observations: was a similar LIVE proposal (same
 * person, same kind, same thing — or the same title) accepted after it?
 * proposals: [{ user_id, kind, title, payload, status, created_at }]
 */
export function laterAccepted(observations = [], proposals = []) {
  return (observations || []).map((o) => {
    const t = Date.parse(o.created_at || 0);
    const similar = (proposals || []).filter((p) => p.user_id === o.user_id && p.kind === o.kind && Date.parse(p.created_at || 0) >= t
      && ((thingOf(p.payload) && thingOf(p.payload) === thingOf(o.payload)) || norm(p.title) === norm(o.title)));
    return { ...o, similarLater: similar.length, acceptedLater: similar.some((p) => ACCEPTED.has(p.status)) };
  });
}
