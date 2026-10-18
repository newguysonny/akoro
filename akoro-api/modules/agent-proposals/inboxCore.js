/**
 * modules/agent-proposals/inboxCore.js — the one inbox's pure rules (no db):
 * merging both sources, refs, dismiss reasons, title normalisation.
 */
export const DISMISS_REASONS = Object.freeze(["not_useful", "wrong_time", "too_much", "already_doing", "other"]);
export const reasonOf = (r) => (DISMISS_REASONS.includes(r) ? r : "other");
export const normalizeTitle = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Both sources as one list, newest first, the same title offered twice shown once. */
export function mergeInbox({ suggestions = [], proposals = [] } = {}) {
  const items = [
    ...suggestions.map((s) => ({
      ref: `s:${s.id}`, id: s.id, source: "chat", kind: s.kind || "task",
      title: s.title, why: s.rationale || null, createdAt: s.created_at, expiresAt: null,
    })),
    ...proposals.map((p) => ({
      ref: `p:${p.id}`, id: p.id, source: "planner", kind: p.kind,
      title: p.title, why: p.rationale || null, createdAt: p.created_at, expiresAt: p.expires_at || null,
    })),
  ].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const seen = new Set();
  return items.filter((it) => {
    const key = normalizeTitle(it.title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** "s:<uuid>" | "p:<uuid>" → { source, id } or null. */
export function parseRef(ref) {
  const m = /^([sp]):([0-9a-f-]{36})$/i.exec(String(ref || ""));
  return m ? { source: m[1] === "s" ? "chat" : "planner", id: m[2] } : null;
}
