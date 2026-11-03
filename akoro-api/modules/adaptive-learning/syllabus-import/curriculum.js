/**
 * syllabus-import/curriculum.js — the importer's curriculum mode: a NERDC
 * curriculum PDF (THEME → SUB-THEME → TOPIC per class, six columns per topic)
 * → the shape the curriculum module stores (edu.curricula / themes /
 * subthemes / topics). Same pipeline as syllabi — layout text, page chunks,
 * the model per chunk, merge, checks, a draft for review; only the shape and
 * where Publish writes differ.
 *
 * Every NERDC page is headed "THEME: … SUB-THEME: … JSS ONE", so theme,
 * sub-theme and class come from code, per page; the model fills the columns.
 * A topic continued on the next page ("contd.") joins its first half. A file
 * with no such headers (the forewords, *_intro.pdf / *f.pdf) is front matter
 * only. Everything that decides is pure; the model call is injected.
 */
import { chunkPages } from "./structure.js";

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const key = (s) => String(s ?? "").toLowerCase().replace(/\b(contd|cont'd|continued)\b\.?/g, "").replace(/^\s*\d{1,2}\s*\.\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
const WORDS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6 };

/** PURE: "JSS ONE" / "PRIMARY FOUR" / "BASIC 7" / "JS 2" → "JSS 1" / "Primary 4"; null when none. */
export function classLabel(text) {
  const t = String(text || "").toUpperCase();
  let m = t.match(/\bJ\.?S\.?S?\.?\s*(ONE|TWO|THREE|[1-3])\b/);
  if (m) return `JSS ${WORDS[m[1]]}`;
  m = t.match(/\bPRIMARY\s*(ONE|TWO|THREE|FOUR|FIVE|SIX|[1-6])\b/);
  if (m) return `Primary ${WORDS[m[1]]}`;
  m = t.match(/\bBASIC\s*([1-9])\b/);
  if (m) { const n = Number(m[1]); return n <= 6 ? `Primary ${n}` : `JSS ${n - 6}`; }
  return null;
}

// The header words in the language editions: Igbo "NGALABA ỌMỤMỤ" / "NKEBI NGALABA ỌMỤMỤ", Hausa "JIGO" /
// "KARAMIN JIGO" (printed with a Cyrillic К), English "THEME" / "SUB-THEME".
const THEME_RE = /^\s*(?:THEMES?|NGALABA\s+ỌMỤMỤ|JIGO)\s*:\s*(.+?)(?:\s{3,}(.*))?$/iu;
const SUB_RE = /^\s*(?:SUB[-\s]?THEMES?|NKEBI\s+NGALABA\s+ỌMỤMỤ|[KК]ARAMIN\s+JIGO)\s*:\s*(.+?)(?:\s{3,}(.*))?$/iu;
const HAUSA_NUM = { "ƊAYA": 1, "DAYA": 1, "BIYU": 2, "UKU": 3, "HUƊU": 4, "HUDU": 4, "BIYAR": 5, "SHIDA": 6 };

/** PURE: Hausa "AJI ƊAYA" (class one) → the stage's class label. */
function hausaClass(text, stage) {
  const m = String(text || "").toUpperCase().match(/\bAJI\s+(ƊAYA|DAYA|BIYU|UKU|HUƊU|HUDU|BIYAR|SHIDA)\b/u);
  if (!m || !stage) return null;
  return stage === "junior" ? `JSS ${HAUSA_NUM[m[1]]}` : `Primary ${HAUSA_NUM[m[1]]}`;
}

/**
 * PURE: share of 1–2 letter fragments among the words. A readable page is
 * ~0.2–0.3; a text layer whose font has no character map (the Yoruba
 * editions) comes out as fragments, ~0.9 — it needs reading from the page image.
 */
export function fragmentRatio(pages = []) {
  const words = pages.map((p) => p.text).join(" ").split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (!words.length) return 1;
  return words.filter((w) => w.replace(/[^\p{L}]/gu, "").length <= 2).length / words.length;
}

/** PURE: each page's printed header → { page, theme, subtheme, class } (carried over when a page has none). */
export function pageHeaders(pages = [], { stage = null } = {}) {
  let cur = { theme: null, subtheme: null, class: null };
  return pages.map((p) => {
    const lines = p.text.split("\n").slice(0, 12);
    const th = lines.map((l) => l.match(THEME_RE)).find(Boolean);
    const st = lines.map((l) => l.match(SUB_RE)).find(Boolean);
    if (th) cur = { ...cur, theme: clip(th[1], 160), subtheme: null, class: classLabel(th[2]) || hausaClass(th[2], stage) || cur.class };
    if (st) cur = { ...cur, subtheme: clip(st[1], 160), class: classLabel(st[2]) || hausaClass(st[2], stage) || cur.class };
    const cls = classLabel(lines.join(" ")) || hausaClass(lines.join(" "), stage);
    if (cls) cur = { ...cur, class: cls };
    return { page: p.page, headed: !!(th || st), ...cur };
  });
}

/** PURE: a NERDC file name → subject, stage, classes, and whether it is front matter only. */
const SUBJECTS = {
  maths: "Mathematics", cca: "Cultural and Creative Arts", nvc: "National Values Education", crs: "Christian Religious Studies",
  islamic: "Islamic Studies", prevoc: "Pre-Vocational Studies", basic_science_technology: "Basic Science and Technology",
  basic_science: "Basic Science and Technology", english_studies: "English Studies", business_studies: "Business Studies",
  history: "History", arabic: "Arabic", french: "French", hausa: "Hausa", igbo: "Igbo", yoruba: "Yoruba",
};
export function nerdcFromFile(fileName) {
  const base = String(fileName || "").replace(/^.*[\\/]/, "").replace(/\.pdf$/i, "").toLowerCase();
  const m = base.match(/^(pri|jss)(\d)-(\d)_(.+)$/);
  if (!m) return null;
  let rest = m[4];
  const intro = /_intro$/.test(rest) || /^(crs|nvc|islamic|history)f$/.test(rest);
  rest = rest.replace(/_intro$/, "").replace(/^(crs|nvc|islamic|history)f$/, "$1");
  const subject = SUBJECTS[rest] || rest.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const [a, b] = [Number(m[2]), Number(m[3])];
  const stage = m[1] === "jss" ? "junior" : "primary";
  const classes = Array.from({ length: b - a + 1 }, (_, i) => (stage === "junior" ? `JSS ${a + i}` : `Primary ${a + i}`));
  return { subject, stage, classes, intro };
}

export const CURRICULUM_FRONT_SYSTEM = `You read the front matter of a Nigerian (NERDC) curriculum document and return ONLY JSON:
{ "title": the document's title, e.g. "Mathematics Curriculum" or null, "subject": the subject or null,
  "edition_year": the year of this edition (e.g. 2012) or null,
  "foreword": the foreword text, faithfully, or null, "preface": the preface text or null,
  "introduction": the introduction text or null, "objectives": the curriculum's objectives as one text (keep numbering, "; " between) or null }
Copy the words; do not summarise or invent. Unknown → null.`;

export const CURRICULUM_CHUNK_SYSTEM = `You transcribe part of a Nigerian (NERDC) curriculum into JSON. The text keeps the page layout: the table's columns sit side by side on the same lines, in order:
TOPIC | PERFORMANCE OBJECTIVES | CONTENT | ACTIVITIES (TEACHER, then PUPILS/STUDENTS) | TEACHING AND LEARNING RESOURCES | EVALUATION GUIDE.
Read each row across its columns and keep each topic's cells together.
Return ONLY JSON:
{ "topics": [ { "title": string, "page": the page number it is on, "continues": true when it is a topic carried on from an earlier page ("contd."),
    "performanceObjectives": [string], "content": [string], "teacherActivities": [string], "studentActivities": [string],
    "materials": [string], "evaluation": [string] } ] }
Rules:
- One entry per numbered/lettered item in a cell ("1. identify common factors…" → one string); do not merge a list into one string, do not split one item.
- Keep the wording verbatim (objectives are assessed against); only fix broken spacing inside words ("G uides" → "Guides").
- Drop lead-ins that are not items ("Pupils should be able to:", "Students to:").
- Theme, sub-theme and class are given per page — do not output them.
- Front matter, contents pages and blank pages have no topics: return {"topics": []}.`;

function parseJson(text) {
  let s = String(text || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) s = fence[1].trim();
  return JSON.parse(s);
}
const list = (v, n = 600) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => clip(x, n)).filter(Boolean);

/** PURE: a chunk's answer → topics, each placed under its page's theme / sub-theme / class. */
export function placeTopics(out, headersByPage, chunk) {
  return (Array.isArray(out?.topics) ? out.topics : []).map((t) => {
    const page = Number(t?.page) >= chunk.from && Number(t?.page) <= chunk.to ? Number(t.page) : chunk.from;
    const h = headersByPage.get(page) || {};
    return {
      title: clip(t?.title, 200), page, continues: t?.continues === true || /\b(contd|continued)\b/i.test(String(t?.title || "")),
      theme: h.theme || null, subtheme: h.subtheme || null, class: h.class || null,
      performanceObjectives: list(t?.performanceObjectives), content: list(t?.content), teacherActivities: list(t?.teacherActivities),
      studentActivities: list(t?.studentActivities), materials: list(t?.materials, 300), evaluation: list(t?.evaluation),
    };
  }).filter((t) => t.title);
}

const COLUMNS = ["performanceObjectives", "content", "teacherActivities", "studentActivities", "materials", "evaluation"];

/** PURE: topics in page order; a topic continued on the next page (same class, theme, sub-theme and title) joins the first half. */
export function mergeCurriculumTopics(perChunk = []) {
  const out = [];
  for (const t of perChunk.flat()) {
    const prev = out[out.length - 1];
    const same = prev && prev.class === t.class && prev.theme === t.theme && prev.subtheme === t.subtheme && key(prev.title) === key(t.title);
    if (same) { for (const c of COLUMNS) prev[c] = [...prev[c], ...t[c]]; continue; }
    const { continues, ...rest } = t;
    out.push({ ...rest, title: rest.title.replace(/\s*\b(contd|cont'd|continued)\b\.?\s*$/i, "").trim() });
  }
  return out;
}

/** PURE: themes and sub-themes in order of first appearance, from the topics. */
export function outlineOf(topics = []) {
  const themes = [];
  const subthemes = [];
  for (const t of topics) {
    if (t.theme && !themes.some((x) => x.title === t.theme)) themes.push({ title: t.theme });
    if (t.theme && t.subtheme && !subthemes.some((x) => x.theme === t.theme && x.title === t.subtheme && x.class === t.class)) subthemes.push({ theme: t.theme, title: t.subtheme, class: t.class });
  }
  return { themes, subthemes };
}

/** PURE: what a reviewer should look at. */
export function checkCurriculum({ topics = [], pages = [], headers = [], failed = [] }) {
  const warnings = [];
  for (const c of failed) warnings.push({ kind: "chunk_failed", text: `Pages ${c.from}–${c.to} could not be read — check them by hand.` });
  const noObj = topics.filter((t) => !t.performanceObjectives.length).length;
  if (noObj) warnings.push({ kind: "no_objectives", text: `${noObj} topic(s) have no performance objectives.` });
  const unplaced = topics.filter((t) => !t.theme || !t.class).length;
  if (unplaced) warnings.push({ kind: "unplaced", text: `${unplaced} topic(s) have no theme or class from the page header.` });
  const headed = new Set(headers.filter((h) => h.headed).map((h) => h.page));
  const covered = new Set(topics.map((t) => t.page));
  const empty = [...headed].filter((p) => !covered.has(p) && !covered.has(p - 1));
  if (empty.length) warnings.push({ kind: "empty_pages", text: `No topic was read from page(s) ${empty.slice(0, 12).join(", ")}${empty.length > 12 ? "…" : ""}.` });
  const count = (c) => topics.reduce((n, t) => n + t[c].length, 0);
  const { themes, subthemes } = outlineOf(topics);
  return {
    stats: {
      pages: pages.length, chars: pages.reduce((n, p) => n + p.text.length, 0),
      classes: [...new Set(topics.map((t) => t.class).filter(Boolean))],
      themes: themes.length, subthemes: subthemes.length, topics: topics.length,
      objectives: count("performanceObjectives"), activities: count("teacherActivities") + count("studentActivities"),
      materials: count("materials"), evaluation: count("evaluation"),
    },
    warnings,
  };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/**
 * Structure a curriculum. hint: { body, subject, stage, classes, intro } (from nerdcFromFile).
 * → { doc: { kind: "curriculum", … }, stats, warnings }
 */
export async function structureCurriculum({ pages, hint = {}, ask, concurrency = 3, onProgress = () => {} }) {
  const headers = pageHeaders(pages, { stage: hint.stage || null });
  const byPage = new Map(headers.map((h) => [h.page, h]));
  const firstHeaded = headers.find((h) => h.headed)?.page || null;
  const frontPages = firstHeaded ? pages.filter((p) => p.page < firstHeaded) : pages;
  const front = (frontPages.length ? frontPages : pages.slice(0, 3)).map((p) => p.text).join("\n").replace(/[ \t]{4,}/g, "   ").slice(0, 24_000);
  let meta = {};
  try { meta = parseJson(await ask({ system: CURRICULUM_FRONT_SYSTEM, user: `Subject: ${hint.subject || "unknown"}.\n\n${front}`, maxTokens: 4000 })); }
  catch { meta = {}; }
  const chunks = firstHeaded ? chunkPages(pages.filter((p) => p.page >= firstHeaded)) : [];
  let done = 0;
  const failed = [];
  const perChunk = await pool(chunks, concurrency, async (c) => {
    const heads = headers.filter((h) => h.page >= c.from && h.page <= c.to)
      .map((h) => `page ${h.page}: ${h.class || "?"} · THEME ${h.theme || "?"} · SUB-THEME ${h.subtheme || "?"}`).join("\n");
    const user = `Subject: ${hint.subject || meta.subject || "unknown"}. Pages ${c.from}–${c.to}.\nPage headers (for reference):\n${heads}\n\nTranscribe this part:\n"""${c.text}"""`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const topics = placeTopics(parseJson(await ask({ system: CURRICULUM_CHUNK_SYSTEM, user, maxTokens: 8000 })), byPage, c);
        onProgress({ done: ++done, of: chunks.length });
        return topics;
      } catch { /* one retry */ }
    }
    failed.push(c);
    onProgress({ done: ++done, of: chunks.length });
    return [];
  });
  const topics = mergeCurriculumTopics(perChunk);
  const { themes, subthemes } = outlineOf(topics);
  const subject = hint.subject || clip(meta.subject, 120) || "Untitled";
  const doc = {
    kind: "curriculum", body: hint.body || "nerdc",
    title: clip(meta.title, 200) || `${subject} Curriculum`, subject,
    stage: hint.stage || null,
    classes: hint.classes?.length ? hint.classes : [...new Set(topics.map((t) => t.class).filter(Boolean))],
    edition_year: Number(meta.edition_year) || null,
    frontMatterOnly: !topics.length,
    foreword: clip(meta.foreword, 20_000) || null, preface: clip(meta.preface, 20_000) || null,
    introduction: clip(meta.introduction, 20_000) || null, objectives: clip(meta.objectives, 8000) || null,
    themes, subthemes,
    topics: topics.map(({ page, ...t }) => ({ ...t, sourcePage: page })),
  };
  const checked = checkCurriculum({ topics, pages, headers, failed });
  if (/arabic/i.test(subject)) checked.warnings.push({ kind: "script", text: "Arabic: this PDF's text layer scrambles Arabic letters — compare every topic with the PDF, or read it from the page images." });
  return { doc, ...checked };
}
