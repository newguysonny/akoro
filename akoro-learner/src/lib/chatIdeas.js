/*
 * chatIdeas.js — the suggestion chips in the learner's Agent Chat.
 *
 * A fresh chat shows CHAT_STARTERS under the welcome — concrete examples of
 * what the agent can do, so a new learner sees how to use it. After that,
 * every reply carries three follow-ups from POST /api/adaptive/chat/suggestions.
 * A chip fills the message box; the learner sends it (or changes it first).
 */

/* label/fill are the English text; the keys translate them (en.js). */
export const CHAT_STARTERS = Object.freeze([
  { labelKey: 'agent.starter_explain',  label: 'Explain a topic simply',  fillKey: 'agent.starter_explain_fill',  fill: 'Explain photosynthesis in simple words' },
  { labelKey: 'agent.starter_quiz',     label: 'Quiz me',                 fillKey: 'agent.starter_quiz_fill',     fill: 'Quiz me with 5 questions on fractions' },
  { labelKey: 'agent.starter_plan',     label: 'Make a study plan',       fillKey: 'agent.starter_plan_fill',     fill: 'Make me a 2-week study plan for my maths exam' },
  { labelKey: 'agent.starter_homework', label: 'Help with homework',      fillKey: 'agent.starter_homework_fill', fill: 'Help me with my homework — I will attach a photo of it' },
  { labelKey: 'agent.starter_task',     label: 'Remind me to study',      fillKey: 'agent.starter_task_fill',     fill: 'Create a task to revise chemistry tomorrow at 5pm' },
  { labelKey: 'agent.starter_progress', label: 'How am I doing?',         fillKey: 'agent.starter_progress_fill', fill: 'Show my learning progress' },
]);

/** The API's suggestions → chips (trimmed, distinct, at most 3). */
export function cleanIdeas(list) {
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 80 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push({ label: t, fill: t });
    if (out.length === 3) break;
  }
  return out;
}
