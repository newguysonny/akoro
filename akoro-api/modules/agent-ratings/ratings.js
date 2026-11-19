/**
 * agent-ratings/ratings.js — ratings on agent replies (Grand Plan Phase 18
 * item 4). Pure.
 *
 * A learner rates one of their own agent messages up or down, with an
 * optional short reason. Ratings are a HUMAN LABEL for the evals and the
 * Phase 17 episodes; they never reach the model's context (nothing that
 * builds a prompt reads edu.agent_message_ratings — pinned by the contract
 * test).
 *
 * The join to the episode: an episode holds no user id and no way back to
 * the learner (training/SPEC.md §9.6). It carries `label_key`, a keyed hash
 * of (surface, message id) — the rating route can find the episode from the
 * message, but the episode store alone can't find the message.
 */
import { createHmac } from "node:crypto";
import { scrubText, SENSITIVE } from "../agent-contract/index.js";

export const SURFACES = Object.freeze(["agent_chat", "workflow_summary"]);
export const RATINGS = Object.freeze(["up", "down"]);
export const REASON_MAX = 280;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isMessageId = (id) => UUID.test(String(id || ""));
export const isSurface = (s) => SURFACES.includes(s);

/** PURE: the learner's input → { rating, reason } or { error }. */
export function normaliseRating(body = {}) {
  const rating = String(body?.rating || "").trim().toLowerCase();
  if (!RATINGS.includes(rating)) return { error: "rating must be up or down" };
  const raw = body?.reason == null ? "" : String(body.reason);
  const reason = raw.replace(/\s+/g, " ").trim();
  if (reason.length > REASON_MAX) return { error: `reason must be ${REASON_MAX} characters or fewer` };
  return { rating, reason: reason || null };
}

/**
 * PURE: the keyed hash that ties a message to its episode. Null without a
 * server secret (then nothing is joined — fail closed, never a plain id).
 */
export function labelKeyFor(surface, messageId, env = process.env) {
  const secret = env.EPISODE_LABEL_SECRET || env.JWT_SECRET || "";
  if (!secret || !isSurface(surface) || !isMessageId(messageId)) return null;
  return createHmac("sha256", `episode-label:${secret}`).update(`${surface}:${String(messageId).toLowerCase()}`).digest("hex").slice(0, 40);
}

/**
 * PURE: the label stored on the episode — the rating and, when it is safe to
 * keep, the reason with what identifies a person replaced (SPEC §9.5). A
 * reason that touches a sensitive topic is dropped, the rating kept.
 */
export function humanLabel({ rating, reason = null, surface }, { names = [] } = {}) {
  if (!RATINGS.includes(rating)) return null;
  let text = reason ? scrubText(reason, { names }).slice(0, REASON_MAX) : null;
  if (text && SENSITIVE.test(text)) text = null;
  return { rating, reason: text || null, surface, source: "learner" };
}

/** PURE: up/down counts and the up-rate per surface. rows: [{ surface, rating }] */
export function rateBySurface(rows = []) {
  const out = Object.fromEntries(SURFACES.map((s) => [s, { surface: s, up: 0, down: 0, total: 0, upRate: null }]));
  for (const r of rows) {
    const s = out[r?.surface];
    if (!s || !RATINGS.includes(r.rating)) continue;
    s[r.rating] += 1;
    s.total += 1;
  }
  for (const s of Object.values(out)) s.upRate = s.total ? Math.round((s.up / s.total) * 1000) / 1000 : null;
  return Object.values(out);
}

/**
 * PURE: the worst-rated turns first. A thumbs-down the code's verdict PASSED
 * (the human and the checks disagree) is the most useful thing to read, then
 * one with a reason, then the newest.
 */
export function worstFirst(turns = []) {
  const score = (t) => (t.rating === "down" ? 4 : 0) + (t.verdict === "pass" ? 2 : 0) + (t.reason ? 1 : 0);
  return [...turns].sort((a, b) => score(b) - score(a) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}
