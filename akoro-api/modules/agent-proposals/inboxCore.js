/**
 * modules/agent-proposals/inboxCore.js — the one inbox's pure rules (no db):
 * merging all three sources, refs, dismiss reasons, title normalisation.
 */
import { READY } from "../autonomy/index.js";
import { RULES } from "../agent-runtime/index.js";
export const DISMISS_REASONS = Object.freeze(["not_useful", "wrong_time", "too_much", "already_doing", "other"]);
export const reasonOf = (r) => (DISMISS_REASONS.includes(r) ? r : "other");
export const normalizeTitle = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** All three sources as one list — Suggestions, newest first, the same title offered twice shown once. */
export function mergeInbox({ suggestions = [], proposals = [], ideas = [] } = {}) {
  const items = [
    ...suggestions.map((s) => ({
      ref: `s:${s.id}`, id: s.id, source: "chat", kind: s.kind || "task",
      title: s.title, why: s.rationale || null, createdAt: s.created_at, expiresAt: null,
    })),
    ...ideas.map((i) => ({
      ref: `i:${i.id}`, id: i.id, source: "idea", kind: "idea",
      title: i.title, why: i.why || null, createdAt: i.created_at, expiresAt: i.expires_at || null,
      icon: i.icon || "chat", context: i.context || {},
    })),
    ...proposals.map((p) => ({
      ref: `p:${p.id}`, id: p.id, source: "planner", kind: p.kind,
      title: p.title, why: p.rationale || null, createdAt: p.created_at, expiresAt: p.expires_at || null,
      // What it prepared and what Yes does (§7.16.3): shown on the Suggestions card too.
      ...(p.preview ? { preview: p.preview } : {}), yes: READY[p.kind]?.yes || null, ...(READY[p.kind]?.cost ? { cost: READY[p.kind].cost } : {}),
      // Asked or inferred (Phase 18 item 6): the agent's idea, and the proactive kind that allowed it.
      basis: p.basis || "inferred", rule: p.basis_rule || RULES.proactive(p.kind),
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

/** "s:<uuid>" | "p:<uuid>" | "i:<uuid>" → { source, id } or null. */
export function parseRef(ref) {
  const m = /^([spi]):([0-9a-f-]{36})$/i.exec(String(ref || ""));
  return m ? { source: { s: "chat", p: "planner", i: "idea" }[m[1].toLowerCase()], id: m[2] } : null;
}
