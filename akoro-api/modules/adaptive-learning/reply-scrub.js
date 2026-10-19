/**
 * modules/adaptive-learning/reply-scrub.js — what never reaches the learner in
 * an Agent Chat reply: the internal ids the model can see in tool results.
 * Tool observations carry a correlation id ("req_1c3838ef") and records carry
 * UUIDs; a model sometimes repeats them ("Done (request req_1c3838ef)",
 * "Record ID: 77d17a49-…"). The app shows names and links instead.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const REQ = "req_[0-9a-f]{6,}";

export function scrubInternalIds(text) {
  let s = String(text ?? "");
  // A whole line that only labels an id ("- **Record ID:** `…`") goes.
  s = s.replace(new RegExp(`^[ \\t]*(?:[-*•]\\s*)?(?:\\*\\*)?[A-Za-z ]{0,20}\\b(?:id|ID|Id)\\b:?(?:\\*\\*)?:?\\s*\`?(?:${UUID}|${REQ})\`?[ \\t]*\\r?\\n?`, "gim"), "");
  // "(request req_…)", "(id: …)", "[ref …]" asides go with their brackets.
  s = s.replace(new RegExp(`\\s*[([]\\s*(?:[A-Za-z ]{0,20}\\b(?:id|ref|request)\\b:?\\s*)?\`?(?:${UUID}|${REQ})\`?\\s*[)\\]]`, "gi"), "");
  // Any id left in prose: a request id with its label ("request id req_…"), a
  // UUID alone, so "your record … is saved" still reads "your record is saved".
  s = s.replace(new RegExp(`\\s*(?:\\brequest\\s+(?:id\\s+)?)?\`?${REQ}\`?`, "gi"), "");
  s = s.replace(new RegExp(`\\s*(?:\\bid\\s+)?\`?${UUID}\`?`, "gi"), "");
  return s.replace(/\s*[—–-]\s*([.,;:!?])/g, "$1").replace(/[ \t]+([.,;:!?])/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A turn that gave the learner Teach me (ask_to_be_taught ran) opens by saying
 * the protégé wasn't taught it — PROTEGE.md asks for that line and some models
 * drop it once the button is there. Code adds it when the reply doesn't say so.
 */
const SAYS_NOT_TAUGHT = /\b(haven['’]?t|have not|not yet|wasn['’]?t|never)\b[^.]{0,40}\b(taught|teach)/i;

export function ensureNotTaughtOpener(reply, toolExecutions = []) {
  const text = String(reply ?? "");
  const asked = (Array.isArray(toolExecutions) ? toolExecutions : [])
    .find((t) => t?.tool === "ask_to_be_taught" && t.success !== false && (t.input?.topic || t.result?.topic));
  if (!asked || SAYS_NOT_TAUGHT.test(text)) return text;
  const topic = String(asked.result?.topic || asked.input?.topic).replace(/\s+/g, " ").trim().slice(0, 80);
  const opener = `You haven't taught me ${topic} yet!`;
  return text.trim() ? `${opener}\n\n${text.trim()}` : opener;
}
