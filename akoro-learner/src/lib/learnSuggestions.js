/**
 * learnSuggestions.js — the "Learn suggestions" in the session's
 * LEARNING WITH GUIDE chat, drawn from what the learner is studying:
 *
 *   1. the session's material (a library record, a PDF, a course video's
 *      transcript, the reference text) — its title and its key terms;
 *   2. no material → the topic and its planned subtopics.
 *
 * `localLearnSuggestions` is instant and offline (shown at once);
 * `learnSuggestionInput` is what POST /api/adaptive/chat/learn-suggestions
 * receives for AI suggestions grounded in the same text, which replace the
 * local ones when they arrive. A suggestion fills the composer; the learner
 * sends it or edits it first.
 */

const STOP = new Set(('a an the and or but if then than that this these those there their they them it its is are was were be been being ' +
  'of in on at by for with from to into onto over under about as also such so not no can could may might will would shall should must ' +
  'has have had do does did done which who whom whose what when where why how all any each every some many much more most other ' +
  'one two three first second also very just only same both between within without through during before after above below up down out ' +
  'we our you your he she his her him i me my page pages figure fig table chapter section example examples called known used use using ' +
  'however therefore thus because while although whereas etc e.g i.e per via').split(/\s+/));

const ICONS = Object.freeze({ summary: 'ti-notes', explain: 'ti-bulb', quiz: 'ti-help-circle', example: 'ti-world' });
export const LEARN_EXCERPT_CHARS = 3000;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const short = (s, n = 48) => { const t = clean(s); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const titleOf = (s) => clean(s).replace(/\.(pdf|docx?|pptx?|txt|png|jpe?g|webp|mp4|mp3|m4a)$/i, '').replace(/[_]+/g, ' ');

/** The material's text from the session (content pages, else the reference). */
export function materialText({ content = null, reference = null } = {}) {
  const pages = content?.state === 'ready' && Array.isArray(content.pages) ? content.pages : [];
  const fromPages = pages.map((p) => clean(p?.text)).filter(Boolean).join('\n');
  return fromPages || clean(reference?.text);
}

/**
 * The most telling terms in a text: repeated two-word phrases first (they
 * name concepts: "cell wall", "electron configuration"), then single words.
 */
export function keyTerms(text, max = 3) {
  const words = clean(text).toLowerCase().replace(/[^a-z0-9À-ɏ\s-]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !/^\d+$/.test(w));
  const pairs = new Map(), singles = new Map();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (STOP.has(w)) continue;
    if (w.length > 3) singles.set(w, (singles.get(w) || 0) + 1);
    const n = words[i + 1];
    if (n && !STOP.has(n)) { const k = `${w} ${n}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
  }
  const ranked = (m, min) => [...m.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([k]) => k);
  const out = [];
  for (const k of [...ranked(pairs, 2), ...ranked(singles, 2)]) {
    if (out.some((o) => o.includes(k) || k.includes(o))) continue;
    out.push(k);
    if (out.length === max) break;
  }
  return out;
}

/** → [{ id, icon, label }] — 4 suggestions about this material, or this topic. */
export function localLearnSuggestions({ topic = '', subject = '', title = '', text = '', subtopics = [] } = {}) {
  const name = short(titleOf(title) || topic || subject || 'this lesson');
  const hasMaterial = !!clean(text);
  const terms = hasMaterial
    ? keyTerms(text)
    : (Array.isArray(subtopics) ? subtopics : []).map((s) => clean(typeof s === 'string' ? s : s?.name || s?.title)).filter(Boolean);
  const t1 = short(terms[0] || topic || name, 40), t2 = short(terms[1] || terms[0] || topic || name, 40);
  return [
    { id: 'summary', icon: ICONS.summary, label: hasMaterial ? `Summarise "${name}"` : `Summarise the key points of ${name}` },
    { id: 'explain', icon: ICONS.explain, label: `Explain ${t1} in simple words` },
    { id: 'quiz',    icon: ICONS.quiz,    label: `Quiz me on ${t2}` },
    { id: 'example', icon: ICONS.example, label: `Give a real-life example of ${t1}` },
  ];
}

/** The body for the AI suggestions: a spread of the material, never all of it. */
export function learnSuggestionInput({ topic = '', subject = '', title = '', text = '', subtopics = [] } = {}) {
  const body = clean(text);
  let excerpt = body;
  if (body.length > LEARN_EXCERPT_CHARS) {
    // The opening, the middle and the end — a long document is more than its first page.
    const part = Math.floor(LEARN_EXCERPT_CHARS / 3);
    const mid = Math.floor(body.length / 2 - part / 2);
    excerpt = [body.slice(0, part), body.slice(mid, mid + part), body.slice(-part)].join(' … ');
  }
  return {
    topic: short(topic, 120), subject: short(subject, 60), title: short(titleOf(title), 120), excerpt,
    subtopics: (Array.isArray(subtopics) ? subtopics : []).slice(0, 8).map((s) => short(typeof s === 'string' ? s : s?.name || s?.title || '', 80)).filter(Boolean),
  };
}

/** The API's strings → suggestions with icons (in the local order of kinds). */
export function shapeLearnSuggestions(list) {
  const kinds = ['summary', 'explain', 'quiz', 'example'];
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const raw = clean(s);
    const label = raw ? raw[0].toUpperCase() + raw.slice(1) : '';   // the model sometimes starts lowercase
    if (!label || label.length > 90 || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const id = kinds[out.length] || `more-${out.length}`;
    out.push({ id, icon: ICONS[id] || 'ti-sparkles', label });
    if (out.length === 4) break;
  }
  return out;
}
