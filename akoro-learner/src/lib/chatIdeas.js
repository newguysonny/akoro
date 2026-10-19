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

/**
 * The protégé's moves on a reply (from the API's toolExecutions):
 *   teach  { topic, subject } — it hasn't been taught this; show "Teach me"
 *   guide  { name }           — the answer came from the teaching guide
 */
export function protegeMoves(executions) {
  const out = {};
  for (const x of Array.isArray(executions) ? executions : []) {
    if (x?.teach?.topic) out.teach = { topic: String(x.teach.topic), subject: String(x.teach.subject || '') };
    if (x?.guide) {
      out.guide = { name: String(x.guide.name || 'NaNa') };
      if (x.guide.teach?.topic && !out.teach) out.teach = { topic: String(x.guide.teach.topic), subject: String(x.guide.teach.subject || '') };
    }
    // Agents an agent search found — shown as cards with Challenge / Ask.
    if (Array.isArray(x?.agents) && x.agents.length) out.agents = x.agents.slice(0, 6);
    // Challenge requests found — shown with Accept.
    if (Array.isArray(x?.requests) && x.requests.length) { out.requests = x.requests.slice(0, 6); out.requestsMine = !!x.requestsMine; }
    // A change a built tool proposes — the learner confirms it on a card (S6).
    if (x?.confirm?.confirmationId) out.confirm = x.confirm;
    // Materials the tools returned — clickable chips to the material itself.
    if (Array.isArray(x?.materials)) out.materials = [...(out.materials || []), ...x.materials];
  }
  if (out.materials) out.materials = cleanMaterials(out.materials);
  return out;
}

/* Only the app's own pages, deduped, at most 8 (the API builds these from
   tool results; the client still refuses anything that isn't a known route). */
const MATERIAL_HREF = [/^\/blog\/[\w-]+$/, /^\/write\/blog\/[\w-]+$/, /^\/course\/[\w-]+$/, /^\/library\?record=[0-9a-f-]{36}(?:&tool=(?:quiz|flashcards|summary|notes|podcast))?$/i, /^\/library\?folder=[0-9a-f-]{36}$/i, /^\/activities\/[\w-]+$/];
export function cleanMaterials(list) {
  const seen = new Set();
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    const title = String(m?.title || '').trim();
    if (!title) continue;
    const href = typeof m.href === 'string' && MATERIAL_HREF.some((re) => re.test(m.href)) ? m.href : null;
    const teach = m.action?.type === 'teach' && m.action.topic ? { topic: String(m.action.topic), subject: String(m.action.subject || '') } : null;
    if (!href && !teach) continue;
    const key = href || `teach:${teach.topic.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: String(m.kind || ''), title: title.slice(0, 90), ...(href ? { href } : { teach }) });
    if (out.length >= 8) break;
  }
  return out;
}
