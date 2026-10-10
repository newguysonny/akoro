/**
 * agent-network/filters.js — the pure rules behind agent search (no DB).
 *
 *   cleanFilters(raw)          what a search may ask for, bounded and typed
 *   presenceOf(lastSeen, now)  online | today | this_week | away
 *   canFind(viewer, target)    the target's privacy setting, blocks, roles
 *   rankAgents(list, f, me)    the order results come back in
 */

export const ONLINE_WINDOW_MS = 150_000;          // two missed heartbeats and you're offline
export const SCOPES = Object.freeze(["everyone", "classmates", "school", "course", "live_class", "community"]);
export const SORTS = Object.freeze(["relevance", "xp", "rank", "fair", "recent"]);
export const BATTLE_TIMES = Object.freeze(["morning", "afternoon", "evening", "night", "weekend"]);
export const VISIBILITY = Object.freeze(["everyone", "school", "classmates", "hidden"]);
export const PAGE_SIZE = 20;

const str = (v, max = 80) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};
const int = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
};
const bool = (v) => v === true || v === "true" || v === 1 || v === "1";

/** A search request → clean filters (unknown keys dropped). */
export function cleanFilters(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const f = {
    query: str(r.query ?? r.name, 60),                 // a name or @username
    scope: SCOPES.includes(r.scope) ? r.scope : "everyone",
    scope_id: str(r.scope_id ?? r.course_id ?? r.community_id, 40),
    online_only: r.online_only === undefined ? false : bool(r.online_only),
    available_only: bool(r.available_only),
    open_to_challenges: bool(r.open_to_challenges),
    school: str(r.school, 80),
    same_school: bool(r.same_school),
    year_group: str(r.year_group, 30),
    study_level: str(r.study_level, 30),
    subject: str(r.subject, 60),
    exam: str(r.exam, 20),
    goal: str(r.goal, 80),
    topic: str(r.topic ?? r.knowledge, 80),             // "taught about …"
    complements_me: bool(r.complements_me),            // strong where I'm weak
    min_xp: int(r.min_xp, 0, 10_000_000),
    max_xp: int(r.max_xp, 0, 10_000_000),
    min_level: int(r.min_level, 1, 1000),
    max_level: int(r.max_level, 1, 1000),
    rank_max: int(r.rank_max ?? r.top, 1, 100_000),     // top N nationally
    min_win_rate: int(r.min_win_rate, 0, 100),
    min_battles: int(r.min_battles, 0, 100_000),
    min_past_questions: int(r.min_past_questions, 0, 1_000_000),
    active_within_days: int(r.active_within_days, 1, 90),
    battle_time: BATTLE_TIMES.includes(r.battle_time) ? r.battle_time : null,
    city: str(r.city, 60),
    language: str(r.language, 30),
    fair_match: bool(r.fair_match),
    sort: SORTS.includes(r.sort) ? r.sort : "relevance",
    page: int(r.page, 1, 50) ?? 1,
  };
  if (f.min_xp != null && f.max_xp != null && f.min_xp > f.max_xp) [f.min_xp, f.max_xp] = [f.max_xp, f.min_xp];
  if (f.available_only) f.online_only = true;
  return f;
}

/** How recently someone was here. */
export function presenceOf(lastSeen, now = Date.now()) {
  const t = Date.parse(lastSeen || "");
  if (!Number.isFinite(t)) return "away";
  const ago = now - t;
  if (ago <= ONLINE_WINDOW_MS) return "online";
  if (ago <= 24 * 3600_000) return "today";
  if (ago <= 7 * 24 * 3600_000) return "this_week";
  return "away";
}

const same = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * May the viewer find this agent?
 * viewer: { id, school }, target: { id, role, school, deactivated, settings: { visibility } },
 * rel: { classmate: bool, coursemate: bool }, blocked: Set of user ids blocked either way
 */
export function canFind(viewer, target, rel = {}, blocked = new Set()) {
  if (!target || target.id === viewer.id) return false;
  if (target.deactivated || (target.role && target.role !== "student")) return false;
  if (blocked.has(target.id)) return false;
  const vis = target.settings?.visibility || "everyone";
  if (vis === "hidden") return false;
  if (vis === "classmates") return !!(rel.classmate || rel.coursemate);
  if (vis === "school") return !!(rel.classmate || same(viewer.school, target.school));
  return true;
}

/** May the viewer's agent message this one? (accept_messages works like visibility.) */
export function canMessage(viewer, target, rel = {}, blocked = new Set()) {
  if (!canFind(viewer, target, rel, blocked)) return false;
  const who = target.settings?.accept_messages || "everyone";
  if (who === "nobody") return false;
  if (who === "classmates") return !!(rel.classmate || rel.coursemate);
  if (who === "school") return !!(rel.classmate || same(viewer.school, target.school));
  return true;
}

/** Results order: online first, then what was asked for. */
export function rankAgents(list, f, me = {}) {
  const myXp = Number(me.xp) || 0;
  const presenceScore = { online: 3, today: 2, this_week: 1, away: 0 };
  const key = (a) => {
    switch (f.sort) {
      case "xp": return -(a.xp || 0);
      case "rank": return a.rank ?? Number.MAX_SAFE_INTEGER;
      case "fair": return Math.abs((a.xp || 0) - myXp);
      case "recent": return -(Date.parse(a.lastSeenAt || 0) || 0);
      default:
        // relevance: shared context and matches first, then a fair XP distance
        return -(a.shared.length * 10 + (a.matches?.taught?.length || 0) * 5 + (a.matches?.complements?.length || 0) * 6)
          + Math.min(9, Math.abs((a.xp || 0) - myXp) / Math.max(200, myXp * 0.25));
    }
  };
  return [...list].sort((a, b) =>
    (presenceScore[b.presence] - presenceScore[a.presence]) * (f.sort === "relevance" || f.online_only ? 1 : 0)
    || key(a) - key(b)
    || String(a.agentName).localeCompare(String(b.agentName)));
}

/** A fair match: within ±20% of my XP (at least ±150). */
export function fairRange(myXp) {
  const xp = Math.max(0, Number(myXp) || 0);
  const band = Math.max(150, Math.round(xp * 0.2));
  return { min: Math.max(0, xp - band), max: xp + band };
}

/** The hour band a time falls in (Africa/Lagos, UTC+1) — for battle_time. */
export function battleTimeOf(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const lagos = new Date(d.getTime() + 3600_000);
  const day = lagos.getUTCDay(), h = lagos.getUTCHours();
  if (day === 0 || day === 6) return "weekend";
  return h < 12 ? "morning" : h < 16 ? "afternoon" : h < 21 ? "evening" : "night";
}
