/**
 * modules/self-study/questionPaper.js — an assignment's questions built from
 * the teacher's own words ("5 questions on photosynthesis, 3 MCQ, 2 direct
 * theory"), the same way from the workbench and from the instructor chat.
 *
 * This file holds the generation loop and its checks: the plan is a contract,
 * so a paper that misses it is asked once more and otherwise carries a warning.
 *
 *   parseQuestionRequest(text)   the request → a plan the result is held to
 *   buildPaperMessages(...)      the model's instructions (first draft)
 *   buildRevisionMessages(...)   … and for a follow-up ("make Q4 harder")
 *   normalizePaper(json, plan)   the model's JSON → stored question shape
 *   applyRevision(base, json)    a follow-up's JSON → the next version;
 *                                untouched questions are copied, not rewritten
 *   checkPaper(paper, plan)      does it honour the request? → problems[]
 *   draftPaper / revisePaper     generate, check, retry once, else warn
 *
 * The pieces live beside this file: paperRules.js (the plan), paperPrompts.js
 * (the instructions), paperNormalize.js (the stored shape) and
 * paperTemplate.js / paperLayout.js (the printed paper).
 */
import { dropNulls, paperResponseFormat, revisionResponseFormat } from "./paperSchema.js";
import { familyOf, layoutPaper } from "./paperTemplate.js";
import { MAX_QUESTIONS, kindFor, mergePlan, parseQuestionRequest, str } from "./paperRules.js";
import { normalizePaper, normalizeQuestion } from "./paperNormalize.js";
import { buildPaperMessages, buildRevisionMessages } from "./paperPrompts.js";

export {
  AR_OPTIONS, MAX_QUESTIONS, MAX_VERSIONS, TF_OPTIONS, describePlan, hasFormat, kindFor,
  mergePlan, parseQuestionRequest,
} from "./paperRules.js";
export { normalizePaper } from "./paperNormalize.js";
export { buildPaperMessages, buildRevisionMessages } from "./paperPrompts.js";

/** Sections the template made (not ones the teacher asked for): re-laid out after a revision. */
const TEMPLATE_PART = /^Part [A-Z] – (Multiple Choice|True or False|Short Answers|Calculations|Diagrams|Case Study|Essay)$/;
const templateParts = (sections) => !Array.isArray(sections) || !sections.length || sections.every((x) => TEMPLATE_PART.test(String(x?.title || "")));

/** PURE: the instructions with one more line — what's there kept (each once), the line added once. */
export function withInstructionLine(current, line) {
  const parts = (Array.isArray(current) ? current : [current]).map((x) => String(x || "").trim()).filter(Boolean);
  const now = parts.filter((x, i) => !parts.slice(0, i).some((y) => y.toLowerCase().includes(x.toLowerCase()))).join(" ");
  const add = String(line || "").trim();
  if (!add || now.toLowerCase().includes(add.toLowerCase())) return now;
  return [now, add].filter(Boolean).join(now && !/[.!?]$/.test(now) ? ". " : " ");
}

/** PURE: the part a follow-up names for what it adds ("…to Part A", "in section B") → "A" | null. */
export function targetPart(request) {
  const m = String(request || "").match(/\b(?:to|in|into|under|inside|within|for|on)\s+(?:the\s+)?(?:part|section)\s+([A-H])\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** PURE: the template family of the base paper's Part <letter> (by its first question), or null. */
function partFamily(base, letter) {
  if (!letter) return null;
  const s = (base.sections || []).findIndex((x) => new RegExp(`^Part ${letter}\\b`, "i").test(String(x?.title || "")));
  const first = s < 0 ? null : (base.questions || []).find((q) => q.section === s);
  return first ? familyOf(first) : null;
}

/**
 * A follow-up's JSON over the base version → the next paper and what
 * changed. Items that point back ({ from }) are copied from the base as-is
 * (the teacher's own edits included); changed ones are rewritten.
 * → { paper, changes: { [newIndex]: "new"|"changed" }, note }
 */
export function applyRevision(base, json, { pinPart = null } = {}) {
  const j = json && typeof json === "object" ? json : {};
  const src = base.questions || [];
  const opts = Math.max(4, ...src.map((q) => (Array.isArray(q.options) ? q.options.length : 0)));
  const questions = [];
  const changes = {};
  for (let item of (Array.isArray(j.questions) ? j.questions : []).slice(0, MAX_QUESTIONS)) {
    if (!item || typeof item !== "object") continue;
    item = dropNulls(item);
    const from = Number.isInteger(item.from) && src[item.from] ? src[item.from] : null;
    if (from && !item.changed) { questions.push(structuredClone(from)); continue; }
    const q = normalizeQuestion(from && !item.text ? { ...from, ...item, text: from.q } : item, { options: Array.isArray(item.options) ? 5 : opts });
    if (!q) { if (from) questions.push(structuredClone(from)); continue; }
    if (from) {
      if (item.keep_figure && from.figure && !q.figure) { q.figure = structuredClone(from.figure); delete q.figure_note; }
      for (const k of ["section", "passage"]) if (Number.isInteger(from[k]) && q[k] == null) q[k] = from[k];
    }
    changes[questions.length] = from ? "changed" : "new";
    questions.push(q);
  }
  // Passages: the existing ones never change here; new scenarios are appended.
  const passages = [...(base.passages || [])];
  if (Array.isArray(j.passages)) {
    for (const p of j.passages.slice(passages.length, 8)) {
      const text = str(p?.text, 8000);
      passages.push({ title: str(p?.title, 160), text });
    }
  }
  for (const q of questions) if (Number.isInteger(q.passage) && !passages[q.passage]?.text) delete q.passage;
  const revised = {
    instructions: base.instructions || "Answer all questions.",
    questions,
    ...(base.sections ? { sections: base.sections } : {}),
    ...(questions.some((q) => Number.isInteger(q.passage)) ? { passages } : {}),
  };
  if (!templateParts(base.sections)) return { paper: revised, changes, note: str(j.note, 200) };
  // What the teacher added to a named part stays in that part (at its end), whatever its kind.
  const fam = partFamily(base, pinPart);
  if (fam) for (const [i, c] of Object.entries(changes)) if (c === "new" && questions[i]) questions[i]._part = fam;
  // The template's Parts again (a new MCQ joins Part A); the change marks follow their questions.
  const { paper, order } = layoutPaper(revised);
  const moved = {};
  order.forEach((old, i) => { if (changes[old]) moved[i] = changes[old]; });
  return { paper, changes: moved, note: str(j.note, 200) };
}

const labelOf = (q) => String(q?.type || "").trim().toLowerCase();

/** Does the paper honour the plan? → problems the model is told about (empty = yes). */
export function checkPaper(paper, plan = {}) {
  const qs = paper?.questions || [];
  const problems = [];
  if (!qs.length) return ["No questions came back."];
  if (plan.total && qs.length !== plan.total) problems.push(`Asked for ${plan.total} questions, got ${qs.length}.`);
  for (const x of plan.mix || []) {
    const these = qs.filter((q) => labelOf(q) === x.label.toLowerCase());
    if (these.length !== x.count) problems.push(`Asked for ${x.count} ${x.label}, got ${these.length}.`);
    const wrongKind = these.filter((q) => (x.format ? q.format !== x.format : (x.kind === "mcq") !== Array.isArray(q.options))).length;
    if (wrongKind) problems.push(`${wrongKind} ${x.label} question${wrongKind === 1 ? " is" : "s are"} the wrong kind (${
      x.format === "label" ? "needs a labelled diagram and labels" : x.format === "assertion_reason" ? "needs an assertion and a reason"
        : x.format === "true_false" ? "must be a statement marked true or false" : x.format === "case_study" ? "must follow a scenario passage"
        : x.kind === "mcq" ? "needs options" : "must have no options"}).`);
  }
  for (const w of plan.wanted || []) {
    if (!qs.some((q) => labelOf(q) === w.toLowerCase() || (kindFor(w)?.format && q.format === kindFor(w).format))) problems.push(`Asked for ${w} questions, got none.`);
  }
  const strays = qs.filter((q) => q.format === "case_study" && !Number.isInteger(q.passage)).length;
  if (strays) problems.push(`${strays} case-study question${strays === 1 ? " has" : "s have"} no scenario passage.`);
  const bare = qs.filter((q) => q.format === "label" && !q.figure && !q.figure_note).length;
  if (bare) problems.push(`${bare} labelling question${bare === 1 ? " has" : "s have"} no diagram.`);
  const want = plan.options || 4;
  const badOpts = qs.filter((q) => Array.isArray(q.options) && !q.format && q.options.length !== want && !(plan.mix || []).some((x) => x.options && labelOf(q) === x.label.toLowerCase())).length;
  if (badOpts) problems.push(`${badOpts} multiple-choice question${badOpts === 1 ? " doesn't" : "s don't"} have ${want} options.`);
  const figs = qs.filter((q) => (q.figure || q.figure_note) && q.format !== "label").length + qs.filter((q) => q.format === "label" && (q.figure || q.figure_note)).length;
  if (typeof plan.diagrams === "number" && plan.diagrams > 0 && figs < plan.diagrams) problems.push(`Asked for ${plan.diagrams} question${plan.diagrams === 1 ? "" : "s"} with a diagram, got ${figs}.`);
  if (plan.diagrams === true && !figs) problems.push("Asked for diagrams, got none.");
  if (plan.diagrams === 0 && qs.some((q) => (q.figure || q.figure_note) && q.format !== "label")) problems.push("Asked for no diagrams, but some questions have one.");
  if (plan.totalPoints) {
    const sum = qs.reduce((n, q) => n + (Number(q.max_points) || 0), 0);
    if (sum !== plan.totalPoints) problems.push(`Marks should total ${plan.totalPoints}, got ${sum}.`);
  }
  return problems;
}

/** Marks the paper leaves unset get the API's default, so the total is real. */
export const paperTotal = (paper) => (paper?.questions || []).reduce((n, q) => n + (Number(q.max_points) > 0 ? Number(q.max_points) : 5), 0);

/** "5 questions (3 MCQ · 2 Theory) · 20 marks" — what the chat card says. */
export function summarizePaper(paper) {
  const qs = paper?.questions || [];
  const byType = new Map();
  for (const q of qs) {
    const t = String(q.type || (Array.isArray(q.options) ? "MCQ" : "Open")).trim();
    byType.set(t, (byType.get(t) || 0) + 1);
  }
  const mix = [...byType].map(([t, n]) => `${n} ${t}`).join(" · ");
  const figs = qs.filter((q) => q.figure || q.figure_note).length;
  const total = paperTotal(paper);
  return {
    count: qs.length, mix: [...byType].map(([label, count]) => ({ label, count })), figures: figs, totalPoints: total,
    line: `${qs.length} question${qs.length === 1 ? "" : "s"}${byType.size > 1 || mix ? ` (${mix})` : ""} · ${total} mark${total === 1 ? "" : "s"}${figs ? ` · ${figs} with a diagram` : ""}`,
  };
}

/**
 * Generate, check, retry once with what was wrong, else return the closer
 * attempt with a warning. `chat(messages)` → the model's JSON string.
 * → { paper, warning|null, plan }
 */
export async function draftPaper({ chat, topic, subject, classLevel, request, plan: given, difficulty, subtopics }) {
  const plan = mergePlan(parseQuestionRequest(request), given);
  const ask = async (feedback, previous) => {
    let json = {};
    // The call's own failure (no coins, the provider down) is the teacher's answer; only bad JSON counts as "no questions".
    const text = await chat(buildPaperMessages({ topic, subject, classLevel, request, plan, difficulty, subtopics, feedback, previous }), { response_format: paperResponseFormat() });
    try { json = JSON.parse(text || "{}"); } catch { json = {}; }
    return { json, paper: normalizePaper(json, plan) };
  };
  const first = await ask(null, null);
  let problems = checkPaper(first.paper, plan);
  if (!problems.length) return { paper: first.paper, warning: null, plan };
  const second = await ask(problems, first.json);
  const p2 = checkPaper(second.paper, plan);
  const best = p2.length <= problems.length && second.paper.questions.length ? second : first;
  problems = best === second ? p2 : problems;
  if (!best.paper.questions.length) throw new Error("The AI returned no questions — try again.");
  return { paper: best.paper, warning: problems.length ? problems.join(" ") : null, plan };
}

/**
 * The questions a follow-up asks to rewrite ("make question 2 harder", "reword
 * Q3") that came back with the same wording — a harder question is a new
 * question, not new options under the old one. → problems[]
 */
const REWRITE = /\b(harder|easier|simpler|more (?:difficult|challenging)|less (?:difficult|challenging)|tougher|reword|rewrite|rephrase)\b/i;
export function unchangedRewrites(request, base, paper) {
  const norm = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();
  const now = new Set((paper?.questions || []).map((q) => norm(q.q)));
  const problems = [];
  for (const clause of String(request || "").split(/[,;.]|\band\b/i)) {
    if (!REWRITE.test(clause)) continue;
    for (const m of clause.matchAll(/\b(?:question|q)\s*(\d{1,2})\b/gi)) {
      const n = Number(m[1]);
      const old = base?.questions?.[n - 1]?.q;
      if (old && now.has(norm(old))) problems.push(`Question ${n} was to be rewritten (${clause.trim().slice(0, 60)}), but its wording is unchanged — write a new question, not just new options.`);
    }
  }
  return problems;
}

/**
 * PURE: a follow-up that only sets marks ("Give question 7 5 marks", "make Q2 and Q3 worth 4 marks
 * each", "question 5: 10 marks") → [{ n, points }], else null. Anything else in it → null (the model).
 */
const MARKS_CLAUSE = /^(?:please\s+)?(?:(?:give|make|set|award|change|put)\s+)?((?:(?:question|q)\s*\d{1,2}(?:\s*(?:,|and|&)\s*)?)+)\s*(?::|to|is|as|should be|be|carry|carries|worth|=)?\s*(?:worth\s+|carry\s+)?(\d{1,3}(?:\.5)?)\s*(?:marks?|points?|pts?)(?:\s+each)?$/i;
export function marksOnly(request) {
  const clauses = String(request || "").trim().replace(/[.!]+$/, "").split(/\s*(?:;|\.\s|,\s*(?=(?:and\s+)?(?:give|make|set|award|change|put|question|q)\b)|\band\s+(?=(?:give|make|set|award|change|put)\b))\s*/i).filter(Boolean);
  if (!clauses.length) return null;
  const out = [];
  for (const c of clauses) {
    const m = c.trim().match(MARKS_CLAUSE);
    if (!m) return null;
    for (const n of m[1].match(/\d{1,2}/g)) out.push({ n: Number(n), points: Number(m[2]) });
  }
  return out.length && out.every((x) => x.points > 0) ? out : null;
}

/** A follow-up: the same check-and-retry over applyRevision. → { paper, changes, note, warning } */
export async function revisePaper({ chat, topic, subject, classLevel, request, base, plan: given }) {
  // Marks alone need no writer: the questions stay word for word, only their marks change.
  const marks = marksOnly(request);
  if (marks && marks.every(({ n }) => base?.questions?.[n - 1])) {
    const paper = structuredClone(base);
    const changes = {};
    for (const { n, points } of marks) { paper.questions[n - 1].max_points = points; changes[n - 1] = "changed"; }
    return { paper, changes, note: `Marks set: ${marks.map(({ n, points }) => `Q${n} ${points}`).join(", ")}.`, warning: null };
  }
  // A follow-up only holds counts it states itself ("make it 8 questions").
  // Counts in a follow-up are changes ("add 2 MCQ"), not the paper's totals,
  // so only what can be checked on the whole paper is held: diagrams added
  // or taken away, and the option count.
  const plan = mergePlan(parseQuestionRequest(request), given);
  const baseOpts = Math.max(4, ...(base.questions || []).map((q) => (Array.isArray(q.options) ? q.options.length : 0)));
  const addsFigure = /\b(add|include|put|give|with)\b[^.]{0,40}\b(diagrams?|figures?|graphs?|pictures?|visuals?)\b/i.test(String(request || ""));
  const contract = { total: null, mix: [], options: plan.options || baseOpts, totalPoints: null, diagrams: plan.diagrams === 0 ? 0 : addsFigure ? true : null };
  const ask = async (feedback, previous) => {
    let json = {};
    const text = await chat(buildRevisionMessages({ topic, subject, classLevel, request, base, plan, feedback, previous }), { response_format: revisionResponseFormat() });
    try { json = JSON.parse(text || "{}"); } catch { json = {}; }
    return { json, ...applyRevision(base, json, { pinPart: targetPart(request) }) };
  };
  const check = (paper) => [...checkPaper(paper, contract), ...unchangedRewrites(request, base, paper)];
  const first = await ask(null, null);
  let problems = check(first.paper);
  if (!problems.length) return { ...first, warning: null };
  const second = await ask(problems, first.json);
  const p2 = check(second.paper);
  const best = p2.length <= problems.length && second.paper.questions.length ? second : first;
  problems = best === second ? p2 : problems;
  if (!best.paper.questions.length) throw new Error("The revision came back empty — try again.");
  return { paper: best.paper, changes: best.changes, note: best.note, warning: problems.length ? problems.join(" ") : null };
}
