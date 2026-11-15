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

/**
 * The other half: a reply that says it wasn't taught a topic AND promises the
 * Teach me button, from a turn that never called ask_to_be_taught. The topic
 * it names, so the server can give the button it promised; null otherwise.
 */
export function promisedTeachTopic(reply) {
  const text = String(reply ?? "");
  if (!/\bteach me\b/i.test(text) || !/\bbutton\b/i.test(text)) return null;
  const m = text.match(/\b(?:haven['’]?t|have not|never)\s+(?:yet\s+)?taught\s+me\s+(?:about\s+)?(?:the\s+)?([^.,;:!?—–\n()]{2,60}?)(?:\s+yet\b|\s*[.,;:!?—–\n(]|$)/i);
  const topic = m?.[1]?.replace(/\*+/g, "").trim();
  return topic && !/^(it|this|that|them|anything|this topic|that topic)$/i.test(topic) ? topic : null;
}

/**
 * DeepSeek-style tool-call markup (DSML) sometimes arrives in the CONTENT
 * channel instead of as parsed tool calls — the learner would see raw
 * `<｜｜DSML｜｜ invoke …>` gibberish as the reply. The calls themselves are
 * parsed and run by the provider when they are real; what is left in the text
 * is never prose. Strip whole calls/invoke blocks first, then any stray DSML
 * tag, then a truncated block's tail (a stream cut mid-block).
 */
const DSML_TAG = "<[／/]?[｜|]{2}DSML[｜|]{2}[^>]*>";
export const hasDsmlMarkup = (text) => /<[｜|]{2}DSML[｜|]{2}/.test(String(text ?? ""));

export function stripDsmlMarkup(text) {
  let s = String(text ?? "");
  if (!hasDsmlMarkup(s)) return s;
  s = s.replace(new RegExp(`<[｜|]{2}DSML[｜|]{2}\\s*calls>[\\s\\S]*?<[／/][｜|]{2}DSML[｜|]{2}\\s*calls>`, "g"), "");
  s = s.replace(new RegExp(`<[｜|]{2}DSML[｜|]{2}\\s*invoke\\b[^>]*>[\\s\\S]*?<[／/][｜|]{2}DSML[｜|]{2}\\s*invoke>`, "g"), "");
  s = s.replace(new RegExp(DSML_TAG, "g"), "");
  const cut = s.search(/<[｜|]{2}DSML[｜|]{2}/);
  if (cut >= 0) s = s.slice(0, cut);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
