/**
 * modules/self-tooling/registry.js — the Capability Registry at runtime:
 * code-declared capabilities and Data Views + admin grants, and the
 * goal → relevant-items lookup behind `schema_lookup` (plan §7.2–7.3).
 *
 * Nothing here reads information_schema or exposes a table/column name that
 * isn't an allowlisted view field (rule 25).
 */
import db from "../../db.js";
import { CAPABILITIES, FORBIDDEN, forbiddenFor, capAudience, learnerGrantable, asksForChange } from "./capabilities.js";
import { DATA_VIEWS, describeView, audienceOf } from "./views.js";

let grantsCache = { at: 0, active: new Set() };
const GRANTS_TTL_MS = 30_000;

/** Capabilities an admin has turned on (for everyone), cached briefly. */
export async function activeGrants({ fresh = false } = {}) {
  if (!fresh && Date.now() - grantsCache.at < GRANTS_TTL_MS) return grantsCache.active;
  const now = new Date().toISOString();
  const { data, error } = await db.schema("edu").from("capability_grants")
    .select("capability, expires_at").is("revoked_at", null).is("learner_id", null).limit(500);
  if (error) return grantsCache.active;          // keep the last known set; never widen on error
  grantsCache = { at: Date.now(), active: new Set((data || []).filter((g) => !g.expires_at || g.expires_at > now).map((g) => g.capability)) };
  return grantsCache.active;
}

// What each learner turned on for themselves (an own-data change they approved on a card).
const learnerCache = new Map();
export async function learnerGrants(learnerId, { fresh = false } = {}) {
  if (!learnerId) return new Set();
  const hit = learnerCache.get(learnerId);
  if (!fresh && hit && Date.now() - hit.at < GRANTS_TTL_MS) return hit.active;
  const now = new Date().toISOString();
  const { data, error } = await db.schema("edu").from("capability_grants")
    .select("capability, expires_at").eq("learner_id", learnerId).is("revoked_at", null).limit(100);
  if (error) return hit?.active || new Set();
  const active = new Set((data || []).filter((g) => !g.expires_at || g.expires_at > now).map((g) => g.capability).filter(learnerGrantable));
  if (learnerCache.size > 2000) learnerCache.clear();
  learnerCache.set(learnerId, { at: Date.now(), active });
  return active;
}

/** enabled | locked | forbidden | unknown — after grants (an admin's for everyone, or this learner's own). */
export async function capabilityStatus(name, { learnerId = null } = {}) {
  const cap = CAPABILITIES[name];
  if (!cap) return FORBIDDEN.some((f) => f.name === name) ? "forbidden" : "unknown";
  if (cap.status === "enabled") return "enabled";
  if (cap.status === "locked") {
    if ((await activeGrants()).has(name)) return "enabled";
    return learnerId && learnerGrantable(name) && (await learnerGrants(learnerId)).has(name) ? "enabled" : "locked";
  }
  return "forbidden";
}

const words = (s) => String(s || "").toLowerCase().match(/[a-z0-9]+(?:['’][a-z]+)?/g) || [];
const STOP = new Set(["the", "a", "an", "my", "me", "i", "of", "in", "on", "for", "to", "and", "or", "with", "what", "which", "who", "how", "is", "are", "do", "did", "show", "list", "tell", "get", "find", "all", "this", "that", "from", "by", "at", "be", "can", "you", "your", "it"]);

function score(goalWords, goalText, item) {
  let s = 0;
  for (const k of item.keywords || []) if (goalText.includes(k)) s += k.includes(" ") ? 3 : 2;
  const hay = new Set(words(`${item.description} ${Object.keys(item.fields || {}).join(" ")}`));
  for (const w of goalWords) if (hay.has(w)) s += 1;
  return s;
}

/**
 * The views and capabilities relevant to a goal. Read-only metadata.
 * → { views:[…], capabilities:[{name, does, status}], notAllowed:[…], note }
 */
export async function schemaLookup(goal, { limit = 6, audience = "learner", learnerId = null } = {}) {
  const goalText = ` ${String(goal || "").toLowerCase()} `;
  const goalWords = words(goal).filter((w) => !STOP.has(w));
  const forbidden = forbiddenFor(goal);

  const rankedViews = Object.entries(DATA_VIEWS).filter(([, v]) => audienceOf(v) === audience)
    .map(([name, v]) => ({ name, v, s: score(goalWords, goalText, v) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit);
  const rankedCaps = Object.entries(CAPABILITIES).filter(([, c]) => !c.hidden && capAudience(c) === audience)
    .map(([name, c]) => ({ name, c, s: score(goalWords, goalText, c) }))
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit);

  const capabilities = [];
  for (const { name, c } of rankedCaps) {
    const status = await capabilityStatus(name, { learnerId });
    // needs_your_ok: the learner turns it on themselves on a card; needs_approval: only an admin can.
    capabilities.push({ name, does: c.description, kind: c.kind, status: status === "enabled" ? "available" : learnerGrantable(name) && audience === "learner" ? "needs_your_ok" : "needs_approval",
      ...(c.returns ? { returns: c.returns } : {}) });
  }
  return {
    views: rankedViews.map(({ name, v }) => ({ ...describeView(name, v), status: "available" })),
    capabilities,
    ...(forbidden.length ? { notAllowed: forbidden.map((f) => f.description) } : {}),
    ...(asksForChange(goal) && !capabilities.some((c) => c.kind === "write") && audience === "learner" ? { changeNotPossible: true } : {}),
    note: asksForChange(goal) && !capabilities.some((c) => c.kind === "write") && audience === "learner"
      ? "No change like this can be made yet — nothing you have or can build does it. Say so plainly and offer to ask the Akoro team to add it; when they agree, call create_tool with this goal and it sends the request."
      : !rankedViews.length && !rankedCaps.length
      ? "Nothing in the registry matches this goal — it can't be built from what's available."
      : forbidden.length
        ? "Part of this goal isn't allowed (see notAllowed) — tell the learner plainly; don't try to build it."
        : "Views can be filtered, sorted and counted; capabilities are existing operations. Next: call create_tool with this goal to build the tool and answer from its result. A tool can only use what's listed here as available; needs_your_ok means the learner can turn it on for themselves: tell them you don't have that ability yet but can build a tool for it, and when they agree call create_tool with it in hint.capabilities — they approve on a card and the tool is built. needs_approval means an admin must allow it first — call create_tool with it in hint.capabilities and it will ask an admin for you. These names are internal — tell the learner in plain words (\"your learning sessions\"), never the names.",
  };
}

export { CAPABILITIES, DATA_VIEWS, FORBIDDEN };
