/**
 * modules/self-study/questionPaper.js — an assignment's questions built from
 * the teacher's own words ("5 questions on photosynthesis, 3 MCQ, 2 direct
 * theory"), the same way from the workbench and from the instructor chat.
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
 * The plan is a contract: if the model returns 4 questions for "5", or two
 * MCQs for "3 MCQ", it is asked once more; if it still misses, the version
 * carries a warning instead of quietly changing what the teacher asked for.
 *
 * Questions are stored the way details.questions always has been —
 * { q, type, max_points, difficulty, cognitive_level, options?, correct?,
 *   figure?, figure_note?, section?, passage? } — so the learner stepper,
 * grading and the PDF read them unchanged.
 */
import { sanitizeSvg } from "./paperLayout.js";

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const num = (s) => (s == null ? null : /^\d+$/.test(s) ? Number(s) : WORD_NUM[String(s).toLowerCase()] ?? null);
const NUM = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)";

export const MAX_QUESTIONS = 30;
export const MAX_VERSIONS = 10;

/* Question kinds a teacher names, and what each is. */
const KINDS = [
  { re: /^(mcqs?|objectives?|objective questions?|multiple[- ]choice(?: questions?)?)$/i, label: "MCQ", kind: "mcq" },
  { re: /^(?:direct |short )?theory(?: questions?)?$/i, label: "Theory", kind: "open" },
  { re: /^short[- ]answers?(?: questions?)?$/i, label: "Short answer", kind: "open" },
  { re: /^structured(?: questions?)?$/i, label: "Structured", kind: "open" },
  { re: /^essays?(?: questions?)?$/i, label: "Essay", kind: "open" },
  { re: /^fill[- ]in[- ](?:the[- ])?(?:gaps?|blanks?)(?: questions?)?$/i, label: "Fill in the gap", kind: "open" },
  { re: /^true\s*(?:\/|or)\s*false(?: questions?)?$/i, label: "True or false", kind: "mcq", options: 2 },
  { re: /^calculations?(?: questions?)?$/i, label: "Calculation", kind: "open" },
];
const KIND_WORDS = "(?:direct |short )?theory(?: questions?)?|short[- ]answers?(?: questions?)?|structured(?: questions?)?|essays?(?: questions?)?|"
  + "fill[- ]in[- ](?:the[- ])?(?:gaps?|blanks?)(?: questions?)?|true\\s*(?:\\/|or)\\s*false(?: questions?)?|calculations?(?: questions?)?|"
  + "mcqs?|objectives?(?: questions?)?|multiple[- ]choice(?: questions?)?";

/**
 * The teacher's request → a plan. Anything not stated stays null (the model
 * decides); only what was stated is held as a contract.
 * → { total, mix:[{label,kind,count,options?}], diagrams, options, totalPoints, sections, passage }
 */
export function parseQuestionRequest(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  const plan = { total: null, mix: [], diagrams: null, options: null, totalPoints: null, sections: false, passage: false };
  if (!s) return plan;
  const mixRe = new RegExp(`\\b${NUM}\\s+(${KIND_WORDS})\\b`, "gi");
  let m;
  while ((m = mixRe.exec(s))) {
    const count = num(m[1]);
    const k = KINDS.find((x) => x.re.test(m[2].trim()));
    if (!k || !count) continue;
    const have = plan.mix.find((x) => x.label === k.label);
    if (have) have.count += count;
    else plan.mix.push({ label: k.label, kind: k.kind, count, ...(k.options ? { options: k.options } : {}) });
  }
  // "5 questions" — but not "3 MCQ questions" or "2 diagram questions" (those are parts).
  const totalRe = new RegExp(`\\b${NUM}\\s+(?:[a-z-]+\\s+){0,2}questions?\\b`, "gi");
  const partRe = new RegExp(`^${NUM}\\s+(?:of them\\s+)?(?:with\\s+)?(?:a\\s+)?(?:${KIND_WORDS}|diagrams?|figures?|graphs?|pictures?)`, "i");
  const mixSum = plan.mix.reduce((n, x) => n + x.count, 0);
  for (const t of s.matchAll(totalRe)) {
    if (num(t[1]) && !partRe.test(t[0])) { plan.total = num(t[1]); break; }
  }
  if (!plan.total && mixSum) plan.total = mixSum;
  if (plan.total) plan.total = Math.min(plan.total, MAX_QUESTIONS);

  const dq = new RegExp(`\\b${NUM}\\s+(?:of them\\s+)?(?:with\\s+)?(?:a\\s+)?(?:diagrams?|figures?|graphs?|pictures?)(?:\\s+questions?)?\\b`, "i").exec(s)
    || new RegExp(`\\b${NUM}\\s+(?:questions?\\s+)?(?:with|having|using)\\s+(?:a\\s+)?(?:diagrams?|figures?|graphs?)`, "i").exec(s);
  if (dq && num(dq[1])) plan.diagrams = num(dq[1]);
  else if (/\b(no|without)\s+(diagrams?|figures?|pictures?)\b/i.test(s)) plan.diagrams = 0;
  else if (/\b(diagrams?|figures?|visuals?|graphs?|label(?:led|ed|ling)?\s+(?:the\s+)?(?:parts?|diagram)|illustrat\w*|pictures?)\b/i.test(s)) plan.diagrams = true;

  if (/\b(5|five)\s+options\b|\bA\s*(?:-|–|to)\s*E\b/i.test(s)) plan.options = 5;
  else if (/\b(4|four)\s+options\b|\bA\s*(?:-|–|to)\s*D\b/i.test(s)) plan.options = 4;
  const pts = /\b(?:total(?:\s+of)?|out\s+of|worth)\s+(\d{1,3})\s*(?:marks?|points?|pts)?\b|\b(\d{1,3})\s*(?:marks?|points?)\s+(?:in\s+)?total\b/i.exec(s)
    || /\b(\d{1,3})\s*(?:marks?|points?)\b(?!\s*each)/i.exec(s);
  if (pts) {
    const n = Number(pts[1] || pts[2]);
    if (n > 0 && n <= 500) plan.totalPoints = n;
  }
  plan.sections = /\bsections?\b/i.test(s) && !/\b(no|without)\s+sections?\b/i.test(s);
  plan.passage = /\b(comprehension|passage)\b/i.test(s) && !/\b(no|without)\s+(comprehension|passages?)\b/i.test(s);
  return plan;
}

/** The agent's structured plan (from the tool call) over what the words say. */
export function mergePlan(parsed, given) {
  const out = { ...parsed, mix: [...(parsed?.mix || [])] };
  if (!given || typeof given !== "object") return out;
  if (Array.isArray(given.mix) && given.mix.length) {
    out.mix = given.mix
      .map((x) => ({ label: String(x?.label || "").trim().slice(0, 40), kind: x?.kind === "mcq" ? "mcq" : "open", count: Math.max(0, Math.min(MAX_QUESTIONS, Number(x?.count) || 0)) }))
      .filter((x) => x.label && x.count);
  }
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  if (n(given.total)) out.total = Math.min(MAX_QUESTIONS, n(given.total));
  else if (out.mix.length) out.total = out.mix.reduce((a, x) => a + x.count, 0);
  if (given.diagrams === 0 || given.diagrams === false) out.diagrams = 0;
  else if (n(given.diagrams)) out.diagrams = n(given.diagrams);
  else if (given.diagrams === true) out.diagrams = true;
  if ([4, 5].includes(Number(given.options))) out.options = Number(given.options);
  if (n(given.total_points ?? given.totalPoints)) out.totalPoints = n(given.total_points ?? given.totalPoints);
  if (typeof given.sections === "boolean") out.sections = given.sections;
  if (typeof given.passage === "boolean") out.passage = given.passage;
  return out;
}

/** One line for the chat card and the warning: "5 questions (3 MCQ · 2 Theory)". */
export function describePlan(plan) {
  const mix = (plan?.mix || []).map((x) => `${x.count} ${x.label}`).join(" · ");
  return plan?.total ? `${plan.total} question${plan.total === 1 ? "" : "s"}${mix ? ` (${mix})` : ""}` : mix;
}

const FIGURE_RULES =
  "A FIGURE is a small black-line SVG: <svg viewBox=\"0 0 W H\"> with W ≤ 400 and H ≤ 300, only line, polyline, polygon, rect, circle, ellipse, path and text; " +
  "stroke=\"#000\", fill=\"none\" for shapes, font-size 12–16, every label the question mentions drawn in it. Label parts with letters P, Q, R, S… or numbers " +
  "(never A–D, those are the option letters). The question says \"the diagram below\" and the figure MUST match it. " +
  "Give every figure an \"alt\": one sentence describing what it shows. " +
  "If a good line drawing isn't possible (a photo, a detailed organism, a map), give NO svg: put \"figure_note\" on the question saying what figure the teacher should add.";

function rulesFor(plan) {
  const r = [];
  const opts = plan.options || 4;
  if (plan.total) r.push(`Write EXACTLY ${plan.total} question${plan.total === 1 ? "" : "s"}.`);
  else r.push("Write 5 questions unless the request says otherwise (never more than 12 unless asked).");
  if (plan.mix.length) {
    r.push(`The mix is a contract — exactly: ${plan.mix.map((x) => `${x.count} × "${x.label}" (${x.kind === "mcq" ? `multiple choice, ${x.options || opts} options` : "open answer, no options"})`).join("; ")}. ` +
      `Set each question's "type" to exactly one of those labels. Order: all of the first label, then the next, and so on.`);
  }
  r.push(`Multiple-choice questions have exactly ${opts} options (read as ${opts === 5 ? "A–E" : "A–D"}) and "correct", the 0-based index of the right one; open questions have no options. ` +
    "Options are short and parallel, never \"all of the above\" or \"none of the above\".");
  if (plan.diagrams === 0) r.push("Use NO figures.");
  else if (typeof plan.diagrams === "number") r.push(`Exactly ${plan.diagrams} question${plan.diagrams === 1 ? "" : "s"} must use a figure. ${FIGURE_RULES}`);
  else if (plan.diagrams === true) r.push(`The request asks for diagrams or visuals: add a figure to the questions that are about one (at least 1, at most half the questions). ${FIGURE_RULES}`);
  else r.push(`Use no figures unless a question cannot be asked without one (e.g. reading a graph). ${FIGURE_RULES}`);
  if (plan.totalPoints) r.push(`max_points across all questions sum EXACTLY to ${plan.totalPoints}.`);
  else r.push("Choose max_points per question (MCQ usually 1–2, open answers more) — harder and higher-order questions earn more.");
  if (plan.sections) r.push("Group the questions into the sections the request describes: \"sections\": [{ title, instructions }], each question's \"section\" is its 0-based index.");
  else r.push("Do NOT use sections — one plain numbered list.");
  if (plan.passage) r.push("Write the passage ONCE in \"passages\": [{ title, text }]; the questions about it set \"passage\": 0 and say \"According to the passage…\".");
  else r.push("No passages.");
  return r;
}

const SHAPE =
  'Return JSON: { "instructions": string (ONE line for the top of the paper, e.g. "Answer all questions."), ' +
  '"sections"?: [{ "title", "instructions" }], "passages"?: [{ "title", "text" }], ' +
  '"questions": [ { "text", "type", "max_points", "difficulty" (Easy|Medium|Hard), "cognitive_level" (Recall|Understand|Apply|Analyze|Evaluate|Create), ' +
  '"options"?: string[], "correct"?: number, "figure"?: { "svg", "caption", "alt" }, "figure_note"?: string, "section"?: number, "passage"?: number } ] }';

const level = (lv) => (lv ? `\nClass / level: ${lv}` : "");

/** Messages for a first draft. */
export function buildPaperMessages({ topic, subject, classLevel = null, request = "", plan, difficulty = null, subtopics = null, feedback = null, previous = null }) {
  const system = [
    "You write graded assignment questions for a school class, from the teacher's request. Follow the request exactly — its count, its mix of question types, " +
      "whether it wants diagrams — and nothing more. Pitch the language and difficulty at the class level. Write maths with Unicode, never LaTeX: x², 10³, ½, √2, π, °, ×, ÷, ≤, ≥, ₦.",
    ...rulesFor(plan),
    SHAPE,
  ].join("\n");
  const user = `Teacher's request: ${request ? `"${String(request).slice(0, 1500)}"` : "(none — use the defaults)"}\nTopic: ${topic}\nSubject: ${subject}` + level(classLevel) +
    (difficulty ? `\nDifficulty: ${difficulty}` : "") +
    (Array.isArray(subtopics) && subtopics.length ? `\nCover these areas: ${subtopics.slice(0, 12).join("; ")}` : "");
  const msgs = [{ role: "system", content: system }, { role: "user", content: user }];
  if (feedback && previous) {
    msgs.push({ role: "assistant", content: JSON.stringify(previous).slice(0, 30_000) });
    msgs.push({ role: "user", content: `That doesn't match the request: ${feedback.join(" ")} Return the full corrected JSON.` });
  }
  return msgs;
}

/** The base version as the model sees it: numbered, with what each has. */
function paperForModel(base) {
  return (base.questions || []).map((q, i) => ({
    index: i, text: q.q, type: q.type || (Array.isArray(q.options) ? "MCQ" : "Open"), max_points: q.max_points ?? null,
    difficulty: q.difficulty || null, cognitive_level: q.cognitive_level || null,
    ...(Array.isArray(q.options) ? { options: q.options, correct: q.correct ?? null } : {}),
    ...(q.figure ? { has_figure: true, figure_alt: q.figure.alt || q.figure.caption || "" } : {}),
    ...(q.figure_note ? { figure_note: q.figure_note } : {}),
  }));
}

/** Messages for a follow-up: change only what was asked. */
export function buildRevisionMessages({ topic, subject, classLevel = null, request, base, plan, feedback = null, previous = null }) {
  const opts = plan?.options || Math.max(4, ...(base.questions || []).map((q) => (Array.isArray(q.options) ? q.options.length : 0)));
  const system = [
    "You revise a school assignment the teacher already has. Change ONLY what the teacher's follow-up asks; every other question stays exactly as it is.",
    'Return the full new list in order. For a question that stays the same return just { "from": <its index> }. ' +
      'For a question you change return { "from": <its index>, "changed": true, ...all its fields }. For a new question return all its fields with no "from". ' +
      "A question that is removed is simply left out. Keep a changed question's figure by setting \"keep_figure\": true instead of redrawing it.",
    `Multiple-choice questions have ${opts} options unless the follow-up says otherwise; open questions have no options.`,
    `When the follow-up asks for a diagram: ${FIGURE_RULES}`,
    "Also return \"note\": ONE short line saying what changed, numbered as in the NEW list (e.g. \"Q4 made harder; new Q3 with a diagram\").",
    "Write maths with Unicode, never LaTeX.",
    'Return JSON: { "note": string, "questions": [ ... ] } — question fields as: { "text", "type", "max_points", "difficulty", "cognitive_level", "options"?, "correct"?, "figure"?: { "svg", "caption", "alt" }, "figure_note"? }',
  ].join("\n");
  const user = `Topic: ${topic}\nSubject: ${subject}` + level(classLevel) +
    `\nThe current questions:\n${JSON.stringify(paperForModel(base))}\n\nThe teacher's follow-up: "${String(request || "").slice(0, 1500)}"`;
  const msgs = [{ role: "system", content: system }, { role: "user", content: user }];
  if (feedback && previous) {
    msgs.push({ role: "assistant", content: JSON.stringify(previous).slice(0, 30_000) });
    msgs.push({ role: "user", content: `That doesn't match the follow-up: ${feedback.join(" ")} Return the full corrected JSON.` });
  }
  return msgs;
}

const str = (v, max) => String(v ?? "").trim().slice(0, max);

/** One model question → the stored shape. */
function normalizeQuestion(q, { options = null } = {}) {
  if (!q || typeof q !== "object") return null;
  const text = str(q.text ?? q.q, 2000);
  if (!text) return null;
  const out = {
    q: text,
    type: str(q.type, 40),
    max_points: Number(q.max_points) > 0 ? Math.round(Number(q.max_points) * 2) / 2 : null,
    difficulty: str(q.difficulty, 20),
    cognitive_level: str(q.cognitive_level, 20),
  };
  if (Array.isArray(q.options)) {
    const opts = q.options.map((o) => str(o, 300)).filter(Boolean).slice(0, options || 5);
    if (opts.length >= 2) {
      out.options = opts;
      out.correct = Number.isInteger(q.correct) && q.correct >= 0 && q.correct < opts.length ? q.correct : 0;
    }
  }
  const svg = q.figure && typeof q.figure.svg === "string" ? sanitizeSvg(q.figure.svg) : null;
  if (svg) {
    out.figure = { svg, ...(str(q.figure.caption, 200) ? { caption: str(q.figure.caption, 200) } : {}), ...(str(q.figure.alt, 300) ? { alt: str(q.figure.alt, 300) } : {}) };
  } else if (q.figure && typeof q.figure === "object" && !svg && (q.figure.alt || q.figure.caption)) {
    // A figure the model described but couldn't draw cleanly → a slot for the teacher.
    out.figure_note = str(q.figure.alt || q.figure.caption, 300);
  }
  if (!out.figure && str(q.figure_note, 300)) out.figure_note = str(q.figure_note, 300);
  if (Number.isInteger(q.section)) out.section = q.section;
  if (Number.isInteger(q.passage)) out.passage = q.passage;
  return out;
}

/** The model's first-draft JSON → { instructions, questions, sections?, passages? }. */
export function normalizePaper(json, plan = {}) {
  const j = json && typeof json === "object" ? json : {};
  const sections = (Array.isArray(j.sections) ? j.sections : []).slice(0, 12).map((s) => ({ title: str(s?.title, 120), instructions: str(s?.instructions, 1200) }));
  const passages = (Array.isArray(j.passages) ? j.passages : []).slice(0, 8).map((p) => ({ title: str(p?.title, 160), text: str(p?.text, 8000) })).filter((p) => p.text);
  const mixOpts = new Map((plan.mix || []).filter((x) => x.options).map((x) => [x.label.toLowerCase(), x.options]));
  const questions = (Array.isArray(j.questions) ? j.questions : []).slice(0, MAX_QUESTIONS)
    .map((q) => normalizeQuestion(q, { options: mixOpts.get(String(q?.type || "").toLowerCase()) || plan.options || 5 }))
    .filter(Boolean)
    .map((q) => {
      if (Number.isInteger(q.section) && !sections[q.section]) delete q.section;
      if (Number.isInteger(q.passage) && !passages[q.passage]) delete q.passage;
      return q;
    });
  const usedS = questions.some((q) => Number.isInteger(q.section));
  const usedP = questions.some((q) => Number.isInteger(q.passage));
  return {
    instructions: str(j.instructions, 300) || "Answer all questions.",
    questions,
    ...(usedS ? { sections } : {}),
    ...(usedP ? { passages } : {}),
  };
}

/**
 * A follow-up's JSON over the base version → the next paper and what
 * changed. Items that point back ({ from }) are copied from the base as-is
 * (the teacher's own edits included); changed ones are rewritten.
 * → { paper, changes: { [newIndex]: "new"|"changed" }, note }
 */
export function applyRevision(base, json) {
  const j = json && typeof json === "object" ? json : {};
  const src = base.questions || [];
  const opts = Math.max(4, ...src.map((q) => (Array.isArray(q.options) ? q.options.length : 0)));
  const questions = [];
  const changes = {};
  for (const item of (Array.isArray(j.questions) ? j.questions : []).slice(0, MAX_QUESTIONS)) {
    if (!item || typeof item !== "object") continue;
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
  const paper = {
    instructions: base.instructions || "Answer all questions.",
    questions,
    ...(base.sections ? { sections: base.sections } : {}),
    ...(base.passages ? { passages: base.passages } : {}),
  };
  return { paper, changes, note: str(j.note, 200) };
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
    const wrongKind = these.filter((q) => (x.kind === "mcq") !== Array.isArray(q.options)).length;
    if (wrongKind) problems.push(`${wrongKind} ${x.label} question${wrongKind === 1 ? " is" : "s are"} the wrong kind (${x.kind === "mcq" ? "needs options" : "must have no options"}).`);
  }
  const want = plan.options || 4;
  const badOpts = qs.filter((q) => Array.isArray(q.options) && q.options.length !== want && !(plan.mix || []).some((x) => x.options && labelOf(q) === x.label.toLowerCase())).length;
  if (badOpts) problems.push(`${badOpts} multiple-choice question${badOpts === 1 ? " doesn't" : "s don't"} have ${want} options.`);
  const figs = qs.filter((q) => q.figure || q.figure_note).length;
  if (typeof plan.diagrams === "number" && plan.diagrams > 0 && figs < plan.diagrams) problems.push(`Asked for ${plan.diagrams} question${plan.diagrams === 1 ? "" : "s"} with a diagram, got ${figs}.`);
  if (plan.diagrams === true && !figs) problems.push("Asked for diagrams, got none.");
  if (plan.diagrams === 0 && figs) problems.push("Asked for no diagrams, but some questions have one.");
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
    try { json = JSON.parse(await chat(buildPaperMessages({ topic, subject, classLevel, request, plan, difficulty, subtopics, feedback, previous })) || "{}"); } catch { json = {}; }
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

/** A follow-up: the same check-and-retry over applyRevision. → { paper, changes, note, warning } */
export async function revisePaper({ chat, topic, subject, classLevel, request, base, plan: given }) {
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
    try { json = JSON.parse(await chat(buildRevisionMessages({ topic, subject, classLevel, request, base, plan, feedback, previous })) || "{}"); } catch { json = {}; }
    return { json, ...applyRevision(base, json) };
  };
  const first = await ask(null, null);
  let problems = checkPaper(first.paper, contract);
  if (!problems.length) return { ...first, warning: null };
  const second = await ask(problems, first.json);
  const p2 = checkPaper(second.paper, contract);
  const best = p2.length <= problems.length && second.paper.questions.length ? second : first;
  problems = best === second ? p2 : problems;
  if (!best.paper.questions.length) throw new Error("The revision came back empty — try again.");
  return { paper: best.paper, changes: best.changes, note: best.note, warning: problems.length ? problems.join(" ") : null };
}
