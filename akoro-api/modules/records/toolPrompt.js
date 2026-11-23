/**
 * modules/records/toolPrompt.js — what a learner's free-text Prompt asks for.
 *
 * The form has explicit fields (scope, pages, count, difficulty) AND a Prompt
 * box. Learners write things like "Create 20 hard questions from pages 5–15,
 * WAEC level, using the past questions attached" — expecting the prompt to
 * DRIVE those settings, not decorate them. Parse the prompt once, on the
 * server, and let an explicit request win over a defaulted field.
 *
 * Pure: no db, no model. The caller decides how to apply the result.
 */
const EXAM_BOARDS = /\b(WAEC|WASSCE|JAMB|UTME|NECO|IGCSE|GCSE|SAT|A[- ]?Level|IB)\b/i;
const DIFFICULTY = /\b(easy|simple|basic|medium|moderate|hard|difficult|tough|advanced|challenging)\b/i;
const WHOLE = /\b(whole|entire|full|complete)\s+(document|material|book|text|syllabus)\b|\ball\s+pages\b|\bwhole\s+thing\b/i;
const LENGTH = /\b(short|brief|quick|long|detailed|in[- ]depth)\b/i;
const PAST_Q = /\b(past\s+questions?|past\s+papers?|past\s+(?:test|exam)s?|last\s+year'?s?\s+(?:test|exam|paper)|mock(?:\s+exam)?|exam\s+paper|question\s+bank)\b/i;
const SYLLABUS = /\bsyllabus\b|\bcurriculum\b|\bscheme\s+of\s+work\b/i;
const CONTEXT_REF = /\b(attached|attachment|attachments|syllabus|past\s+questions?|past\s+papers?|past\s+(?:test|exam)s?|last\s+year'?s?\s+(?:test|exam|paper)|mock(?:\s+exam)?|exam\s+paper|question\s+bank|reference\s+material|the\s+files?\s+i\s+(?:added|uploaded)|uploaded)\b/i;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function pageList(text) {
  // "pages 5–15", "pages 5 to 15", "from page 5 through 15"
  const range = /\bpages?\s+(\d{1,3})\s*(?:-|–|—|to|through|until)\s*(\d{1,3})\b/i.exec(text);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (a >= 1 && b >= 1) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      return Array.from({ length: Math.min(30, hi - lo + 1) }, (_, i) => lo + i).filter((n) => n <= 60);
    }
  }
  // "pages 5, 6 and 9" / "page 5"
  const list = /\bpages?\s+((?:\d{1,3})(?:\s*(?:,|and|&)\s*\d{1,3})*)\b/i.exec(text);
  if (list) {
    return [...new Set(list[1].split(/[^0-9]+/).map(Number).filter((n) => n >= 1 && n <= 60))].slice(0, 30);
  }
  return [];
}

/** Prompt → intent. Every field is optional (null/[] means "not asked"). */
export function parseToolPrompt(prompt = "") {
  const text = String(prompt || "").trim();
  if (!text) {
    return { count: null, difficulty: null, exam: null, length: null, pageNumbers: [], wholeDocument: false, referencesContext: false, contextMode: null, text: "" };
  }
  const countMatch = /(\d{1,2})[\s-]+(?:[a-z][a-z-]*[\s-]+){0,3}(?:mcqs?|multiple[\s-]*choice\s+questions?|quiz\s+questions?|questions?|flashcards?|cards?|points?|bullets?)\b/i.exec(text)
    || /(?:create|make|give me|generate|set)\s+(\d{1,2})\b/i.exec(text);
  const difficultyMatch = DIFFICULTY.exec(text);
  const difficulty = difficultyMatch
    ? (/easy|simple|basic/i.test(difficultyMatch[1]) ? "Easy"
      : /medium|moderate/i.test(difficultyMatch[1]) ? "Medium" : "Hard")
    : null;
  const lengthMatch = LENGTH.exec(text);
  return {
    count: countMatch ? clamp(Number(countMatch[1]), 1, 50) : null,
    difficulty,
    length: lengthMatch ? (/short|brief|quick/i.test(lengthMatch[1]) ? "Short · 2–3 min" : /long|detailed|in[- ]depth/i.test(lengthMatch[1]) ? "Long · 8–10 min" : "Medium · 5–6 min") : null,
    exam: (() => { const m = EXAM_BOARDS.exec(text); return m ? m[1].toUpperCase().replace(/\s+/g, "-") : null; })(),
    pageNumbers: pageList(text),
    wholeDocument: WHOLE.test(text),
    referencesContext: CONTEXT_REF.test(text),
    contextMode: PAST_Q.test(text) ? "past_questions" : SYLLABUS.test(text) ? "syllabus" : null,
    text,
  };
}

/**
 * Apply a parsed prompt to the request's explicit fields. The prompt wins for
 * pages / whole document / count / difficulty; the form remains the fallback.
 * Returns the effective scope + values used by gathering, prompts and shaping.
 */
export function applyPromptIntent({ prompt = "", scope = "document", pageNumbers = [], values = {}, contextAttached = false } = {}) {
  const intent = parseToolPrompt(prompt);
  let effectiveScope = scope;
  let effectivePages = Array.isArray(pageNumbers) ? pageNumbers : [];
  if (intent.wholeDocument) {
    effectiveScope = "document";
    effectivePages = [];
  } else if (intent.pageNumbers.length) {
    effectiveScope = "pages";
    effectivePages = intent.pageNumbers;
  }
  const effectiveValues = {
    ...values,
    ...(intent.count != null ? { count: String(intent.count) } : {}),
    ...(intent.difficulty ? { difficulty: intent.difficulty } : {}),
    ...(intent.length ? { length: intent.length } : {}),
  };
  const notes = [];
  if (intent.exam) notes.push(`Match the ${intent.exam} exam style and level: the wording, command verbs and difficulty a ${intent.exam} paper would use.`);
  if (intent.referencesContext && contextAttached) notes.push("Use the attached reference material to match the expected style and scope; the tested facts still come from this document.");
  if (intent.referencesContext && !contextAttached) notes.push("The learner mentions attached reference material, but none is attached to this request — do not claim to have used any.");
  return { intent, scope: effectiveScope, pageNumbers: effectivePages, values: effectiveValues, notes };
}
