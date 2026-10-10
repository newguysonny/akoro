/**
 * modules/adaptive-learning/chatSuggestions.js — after every Agent Chat
 * reply, a few short things the user might ask next ("Make question 2
 * harder", "Add a case study", "Show my classes"), shown as chips under
 * the reply. A chip fills the message box; nothing runs until they send.
 *
 * One small, bounded model call AFTER the reply has arrived — the reply
 * itself never waits for it, and a failure just means no chips.
 */

export const SUGGESTION_LIMITS = Object.freeze({ count: 3, chars: 60, replyChars: 2500, askChars: 800 });

const ROLE_HINTS = {
  instructor:
    "The user is a teacher. Good next steps: refine an activity (harder/easier, add a diagram question, true/false, assertion and reason, " +
    "labelling, a case study, change the marks or due date), prepare work for a class, check how an activity went, schedule a weekly routine.",
  student:
    "The user is a learner. Good next steps: an example, a simpler explanation, practise questions, a quick quiz, a summary, " +
    "connect it to their exam, make a study task.",
};

/** The model's instructions. */
export function buildSuggestionMessages({ role = "student", ask = "", reply = "", context = "" }) {
  const system = [
    `Suggest exactly ${SUGGESTION_LIMITS.count} short things the user could say NEXT in this chat, written as the user would type them ` +
      `(imperative or a question, ≤ 8 words each, no numbering, no quotes, no emoji).`,
    "Each must follow naturally from the assistant's last reply and be something the assistant can actually do. Make them different from each other: " +
      "one that goes deeper, one that changes or adds something, one practical next step.",
    "Never suggest assigning, sending or publishing anything — the user does that with a button.",
    "Write them in the same language the user wrote in (English, Yoruba, Hausa, Igbo, Pidgin, French…).",
    ROLE_HINTS[role === "instructor" ? "instructor" : "student"],
    'Return JSON: { "suggestions": [string, string, string] }',
  ].join("\n");
  const user = `The user said: ${String(ask).slice(0, SUGGESTION_LIMITS.askChars)}\n\nThe assistant replied: ${String(reply).slice(0, SUGGESTION_LIMITS.replyChars)}` +
    (context ? `\n\nContext: ${String(context).slice(0, 600)}` : "");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/** The model's JSON → up to 3 clean, distinct chips. */
export function shapeSuggestions(raw) {
  let json = {};
  try { json = typeof raw === "string" ? JSON.parse(raw) : raw || {}; } catch { json = {}; }
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(json?.suggestions) ? json.suggestions : []) {
    const t = String(s ?? "")
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "")
      .replace(/^["'“]|["'”]$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || t.length > SUGGESTION_LIMITS.chars) continue;
    if (/\b(assign|publish|send it)\b/i.test(t)) continue;   // the human's button, never a chip
    const key = t.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length === SUGGESTION_LIMITS.count) break;
  }
  return out;
}
