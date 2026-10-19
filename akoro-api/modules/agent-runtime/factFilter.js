/**
 * agent-runtime/factFilter.js — the fact filter for an agent's own words to
 * the learner (Grand Plan §7.9.7, D27). A sentence that states a number the
 * agent never saw (in its observations) is dropped; what's left is collapsed,
 * capped and masked. The model's message is never trusted as fact.
 *
 *   keepFactual(message, seenText, { max }) → string ("" when nothing survives)
 */
const PROFANE = /\b(fuck|shit|bitch|asshole|bastard)\w*/gi;

export function keepFactual(message, seenText = "", { max = 400 } = {}) {
  const seen = String(seenText || "");
  const text = String(message || "").replace(/[\r\n\u0000]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  const kept = sentences.filter((s) => (s.match(/\d+(?:[.,]\d+)?%?/g) || []).every((n) => seen.includes(n.replace(/%$/, ""))));
  let out = kept.join(" ").replace(/\s+/g, " ").trim().replace(PROFANE, (w) => `${w[0]}${"*".repeat(w.length - 1)}`);
  if (out.length > max) out = `${out.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
  return out;
}
